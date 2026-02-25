/**
 * LocalTunnels Cloud Deployment
 * Uses ts-cloud for AWS infrastructure deployment
 *
 * Deploys a TunnelServer directly on EC2 with:
 * - EC2 instance running Bun + localtunnels
 * - Security group for HTTP/HTTPS/SSH
 * - Elastic IP for stable addressing
 * - Optional Route53 wildcard DNS
 */

export interface TunnelDeployConfig {
  /**
   * AWS region to deploy to
   * @default 'us-east-1'
   */
  region?: string

  /**
   * Prefix for all resource names
   * @default 'localtunnel'
   */
  prefix?: string

  /**
   * Domain name for the tunnel service (e.g. 'localtunnel.dev')
   * When provided, Route53 DNS records will be created
   */
  domain?: string

  /**
   * Route53 hosted zone ID (auto-detected from domain if not provided)
   */
  hostedZoneId?: string

  /**
   * EC2 instance type
   * @default 't3.micro'
   */
  instanceType?: string

  /**
   * EC2 key pair name for SSH access
   */
  keyName?: string

  /**
   * Enable verbose logging during deployment
   * @default false
   */
  verbose?: boolean

  /**
   * Enable SSL (use HTTPS/WSS)
   * @default false
   */
  enableSsl?: boolean
}

export interface TunnelDeployResult {
  /**
   * Public IP address (Elastic IP)
   */
  publicIp: string

  /**
   * EC2 instance ID
   */
  instanceId: string

  /**
   * Security group ID
   */
  securityGroupId: string

  /**
   * Elastic IP allocation ID
   */
  allocationId: string

  /**
   * HTTP(S) URL for the tunnel server
   */
  serverUrl: string

  /**
   * WebSocket URL for the tunnel server
   */
  wsUrl: string

  /**
   * Domain name (if configured)
   */
  domain?: string

  /**
   * AWS region
   */
  region: string
}

/**
 * Import ts-cloud, handling the case where package.json exports
 * point to src/ (development) but only dist/ exists (published).
 */
async function importTsCloud(): Promise<any> {
  try {
    return await import('@stacksjs/ts-cloud')
  }
  catch {
    // Fallback: resolve package.json location and import from dist/
    const path = await import('node:path')
    const pkgDir = path.dirname(require.resolve('@stacksjs/ts-cloud/package.json'))
    return import(path.join(pkgDir, 'dist/index.js'))
  }
}

/**
 * Deploy the tunnel infrastructure to AWS
 *
 * Launches an EC2 instance running the localtunnels TunnelServer via Bun,
 * assigns an Elastic IP, and optionally sets up Route53 wildcard DNS.
 */
export async function deployTunnelInfrastructure(
  config: TunnelDeployConfig = {},
): Promise<TunnelDeployResult> {
  let EC2Client: any, Route53Client: any, SSMClient: any

  try {
    const tsCloud = await importTsCloud()
    EC2Client = tsCloud.EC2Client
    Route53Client = tsCloud.Route53Client
    SSMClient = tsCloud.SSMClient
  }
  catch {
    throw new Error(
      '@stacksjs/ts-cloud package is required for AWS deployment.\n'
      + 'Install it with: bun add @stacksjs/ts-cloud',
    )
  }

  const region = config.region || 'us-east-1'
  const prefix = config.prefix || 'localtunnel'
  const instanceType = config.instanceType || 't3.micro'
  const verbose = config.verbose || false

  const log = (msg: string) => {
    if (verbose)
      console.log(`[deploy] ${msg}`)
  }

  const ec2 = new EC2Client(region)

  // ============================================
  // Step 1: Find or create VPC and public subnet
  // ============================================

  log('Finding VPC and public subnet...')

  // Try to find an existing VPC (prefer default, then any)
  let vpcId: string | undefined

  const defaultVpcs = await ec2.describeVpcs({
    Filters: [{ Name: 'isDefault', Values: ['true'] }],
  })
  if (defaultVpcs.Vpcs?.[0]?.VpcId) {
    vpcId = defaultVpcs.Vpcs[0].VpcId
    log(`Found default VPC: ${vpcId}`)
  }
  else {
    // Check for any existing VPC
    const allVpcs = await ec2.describeVpcs()
    if (allVpcs.Vpcs?.[0]?.VpcId) {
      vpcId = allVpcs.Vpcs[0].VpcId
      log(`Found existing VPC: ${vpcId}`)
    }
    else {
      // Create a new VPC
      log('No VPC found, creating one...')
      const vpcResult = await ec2.createVpc({
        CidrBlock: '10.0.0.0/16',
        TagSpecifications: [{
          ResourceType: 'vpc',
          Tags: [
            { Key: 'Name', Value: `${prefix}-tunnel-vpc` },
            { Key: 'Project', Value: 'localtunnels' },
          ],
        }],
      })
      vpcId = vpcResult.Vpc?.VpcId
      if (!vpcId) {
        throw new Error('Failed to create VPC')
      }
      log(`Created VPC: ${vpcId}`)

      // Create and attach an internet gateway for public access
      log('Creating internet gateway...')
      const igwResult = await ec2.createInternetGateway({
        TagSpecifications: [{
          ResourceType: 'internet-gateway',
          Tags: [
            { Key: 'Name', Value: `${prefix}-tunnel-igw` },
            { Key: 'Project', Value: 'localtunnels' },
          ],
        }],
      })
      const igwId = igwResult.InternetGatewayId
      if (igwId) {
        log(`Created internet gateway: ${igwId}`)
        await ec2.attachInternetGateway({
          InternetGatewayId: igwId,
          VpcId: vpcId,
        })
        log('Attached internet gateway to VPC')

        // Add a route to the internet gateway in the main route table
        const routeTables = await ec2.describeRouteTables({
          Filters: [
            { Name: 'vpc-id', Values: [vpcId] },
            { Name: 'association.main', Values: ['true'] },
          ],
        })
        const mainRouteTableId = routeTables.RouteTables?.[0]?.RouteTableId
        if (mainRouteTableId) {
          await ec2.createRoute({
            RouteTableId: mainRouteTableId,
            DestinationCidrBlock: '0.0.0.0/0',
            GatewayId: igwId,
          })
          log('Added default route to internet gateway')
        }
      }
      else {
        log('Warning: Could not create internet gateway — instance may not have internet access')
      }
    }
  }

  // Find or create a public subnet
  let subnetId: string | undefined

  const existingSubnets = await ec2.describeSubnets({
    Filters: [{ Name: 'vpc-id', Values: [vpcId!] }],
  })
  if (existingSubnets.Subnets?.[0]?.SubnetId) {
    subnetId = existingSubnets.Subnets[0].SubnetId
    log(`Found subnet: ${subnetId} (${existingSubnets.Subnets[0].AvailabilityZone})`)
  }
  else {
    log('No subnet found, creating one...')
    const subnetResult = await ec2.createSubnet({
      VpcId: vpcId!,
      CidrBlock: '10.0.1.0/24',
      AvailabilityZone: `${region}a`,
      TagSpecifications: [{
        ResourceType: 'subnet',
        Tags: [
          { Key: 'Name', Value: `${prefix}-tunnel-subnet` },
          { Key: 'Project', Value: 'localtunnels' },
        ],
      }],
    })
    subnetId = subnetResult.Subnet?.SubnetId
    if (!subnetId) {
      throw new Error('Failed to create subnet')
    }
    log(`Created subnet: ${subnetId}`)

    // Enable auto-assign public IPs
    await ec2.modifySubnetAttribute({
      SubnetId: subnetId,
      MapPublicIpOnLaunch: { Value: true },
    })
    log('Enabled auto-assign public IPs on subnet')
  }

  // ============================================
  // Step 2: Create security group
  // ============================================

  log('Creating security group...')
  const sgName = `${prefix}-tunnel-sg`
  let securityGroupId: string

  try {
    const sgResult = await ec2.createSecurityGroup({
      GroupName: sgName,
      Description: 'Security group for LocalTunnel server',
      VpcId: vpcId!,
      TagSpecifications: [{
        ResourceType: 'security-group',
        Tags: [
          { Key: 'Name', Value: sgName },
          { Key: 'Project', Value: 'localtunnels' },
        ],
      }],
    })
    securityGroupId = sgResult.GroupId!
    log(`Created security group: ${securityGroupId}`)

    // Add ingress rules for SSH, HTTP, HTTPS
    await ec2.authorizeSecurityGroupIngress({
      GroupId: securityGroupId,
      IpPermissions: [
        { IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'SSH' }] },
        { IpProtocol: 'tcp', FromPort: 80, ToPort: 80, IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTP' }] },
        { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0', Description: 'HTTPS' }] },
      ],
    })
    log('Added ingress rules for SSH, HTTP, HTTPS')
  }
  catch (error: any) {
    if (error.message?.includes('already exists') || error.code === 'InvalidGroup.Duplicate') {
      const sgs = await ec2.describeSecurityGroups({
        Filters: [
          { Name: 'group-name', Values: [sgName] },
          { Name: 'vpc-id', Values: [vpcId!] },
        ],
      })
      securityGroupId = sgs.SecurityGroups?.[0]?.GroupId!
      if (!securityGroupId) {
        throw new Error(`Security group ${sgName} exists but could not be found`)
      }
      log(`Using existing security group: ${securityGroupId}`)
    }
    else {
      throw error
    }
  }

  // ============================================
  // Step 3: Resolve AMI ID via SSM parameter
  // ============================================

  log('Resolving latest Amazon Linux 2023 AMI...')
  let amiId: string

  try {
    const ssm = new SSMClient(region)
    const ssmResult = await ssm.getParameter({
      Name: '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64',
    })
    amiId = ssmResult.Parameter?.Value
    if (!amiId) {
      throw new Error('SSM parameter returned no AMI value')
    }
    log(`Resolved AMI: ${amiId}`)
  }
  catch (error: any) {
    log(`Warning: Could not resolve AMI via SSM: ${error.message}`)
    throw new Error(
      'Could not resolve latest AMI ID via SSM. '
      + 'Ensure AWS credentials have ssm:GetParameter permission.',
    )
  }

  // ============================================
  // Step 4: Generate user data script
  // ============================================

  const serverPort = config.enableSsl ? 443 : 80
  const userData = generateUserData(serverPort)
  log('Generated user data script')

  // ============================================
  // Step 5: Launch EC2 instance
  // ============================================

  log(`Launching ${instanceType} instance...`)

  const runResult = await ec2.runInstances({
    ImageId: amiId,
    InstanceType: instanceType,
    MinCount: 1,
    MaxCount: 1,
    SubnetId: subnetId!,
    SecurityGroupIds: [securityGroupId],
    UserData: btoa(userData),
    TagSpecifications: [{
      ResourceType: 'instance',
      Tags: [
        { Key: 'Name', Value: `${prefix}-tunnel-server` },
        { Key: 'Project', Value: 'localtunnels' },
      ],
    }],
  })

  const instanceId = runResult.Instances?.[0]?.InstanceId

  if (!instanceId) {
    log(`RunInstances response: ${JSON.stringify(runResult, null, 2)}`)
    throw new Error('Failed to launch EC2 instance — could not extract instance ID from response')
  }

  log(`Launched instance: ${instanceId}`)

  if (config.keyName) {
    log(`Note: Key pair "${config.keyName}" was not attached. Use --key-name with runInstances for SSH access.`)
  }

  // ============================================
  // Step 6: Wait for instance to be running
  // ============================================

  // Brief delay for AWS eventual consistency — instance ID may not be
  // immediately findable via DescribeInstances after RunInstances returns
  log('Waiting for instance to be discoverable...')
  await new Promise(resolve => setTimeout(resolve, 5000))

  log('Waiting for instance to reach running state...')
  await ec2.waitForInstanceState(instanceId, 'running', {
    maxWaitMs: 180000,
    pollIntervalMs: 5000,
  })
  log('Instance is running')

  // ============================================
  // Step 7: Allocate and associate Elastic IP
  // ============================================

  let publicIp: string
  let allocationId: string | undefined

  try {
    log('Allocating Elastic IP...')
    const eipResult = await ec2.allocateAddress({
      Domain: 'vpc',
      TagSpecifications: [{
        ResourceType: 'elastic-ip',
        Tags: [
          { Key: 'Name', Value: `${prefix}-tunnel-eip` },
          { Key: 'Project', Value: 'localtunnels' },
        ],
      }],
    })
    allocationId = eipResult.AllocationId!
    publicIp = eipResult.PublicIp!
    log(`Allocated Elastic IP: ${publicIp} (${allocationId})`)

    log('Associating Elastic IP with instance...')
    await ec2.associateAddress({
      AllocationId: allocationId,
      InstanceId: instanceId,
    })
    log('Elastic IP associated')
  }
  catch (error: any) {
    // EIP limit reached — fall back to auto-assigned public IP
    log(`Warning: Could not allocate Elastic IP: ${error.message?.split('<Message>')?.[1]?.split('</Message>')?.[0] || error.message}`)
    log('Falling back to instance auto-assigned public IP...')

    const instanceInfo = await ec2.getInstance(instanceId)
    publicIp = instanceInfo?.PublicIpAddress || ''

    if (!publicIp) {
      throw new Error('Instance has no public IP. Ensure the subnet has MapPublicIpOnLaunch enabled.')
    }
    log(`Using instance public IP: ${publicIp} (note: this IP may change if instance is stopped)`)
  }

  // ============================================
  // Step 8: Optional Route53 DNS setup
  // ============================================

  if (config.domain) {
    log(`Setting up Route53 DNS for ${config.domain}...`)
    try {
      const route53 = new Route53Client(region)

      let hostedZoneId = config.hostedZoneId
      if (!hostedZoneId) {
        const zone = await route53.findHostedZoneForDomain(config.domain)
        hostedZoneId = zone?.Id?.replace('/hostedzone/', '')
      }

      if (hostedZoneId) {
        // Create A record for the domain
        await route53.createARecord({
          HostedZoneId: hostedZoneId,
          Name: config.domain,
          Value: publicIp,
          TTL: 300,
        })
        log(`Created A record: ${config.domain} -> ${publicIp}`)

        // Create wildcard A record for subdomains
        await route53.createARecord({
          HostedZoneId: hostedZoneId,
          Name: `*.${config.domain}`,
          Value: publicIp,
          TTL: 300,
        })
        log(`Created A record: *.${config.domain} -> ${publicIp}`)
      }
      else {
        log(`Warning: Could not find Route53 hosted zone for ${config.domain}`)
        log('DNS records were not created. Set up DNS manually or provide --hosted-zone-id.')
      }
    }
    catch (error: any) {
      log(`Warning: DNS setup failed: ${error.message}`)
      log('The server is deployed but DNS is not configured.')
    }
  }

  // ============================================
  // Done
  // ============================================

  const protocol = config.enableSsl ? 'https' : 'http'
  const wsProtocol = config.enableSsl ? 'wss' : 'ws'
  const serverHost = config.domain || publicIp
  const serverUrl = `${protocol}://${serverHost}`
  const wsUrl = `${wsProtocol}://${serverHost}`

  log('Deployment complete!')

  return {
    publicIp,
    instanceId,
    securityGroupId,
    allocationId: allocationId || '',
    serverUrl,
    wsUrl,
    domain: config.domain,
    region,
  }
}

/**
 * Destroy the tunnel infrastructure
 */
export async function destroyTunnelInfrastructure(
  config: TunnelDeployConfig = {},
): Promise<void> {
  let EC2Client: any, Route53Client: any

  try {
    const tsCloud = await importTsCloud()
    EC2Client = tsCloud.EC2Client
    Route53Client = tsCloud.Route53Client
  }
  catch {
    throw new Error(
      '@stacksjs/ts-cloud package is required for AWS deployment.\n'
      + 'Install it with: bun add @stacksjs/ts-cloud',
    )
  }

  const region = config.region || 'us-east-1'
  const prefix = config.prefix || 'localtunnel'
  const verbose = config.verbose || false

  const log = (msg: string) => {
    if (verbose)
      console.log(`[destroy] ${msg}`)
  }

  const ec2 = new EC2Client(region)

  // ============================================
  // Step 1: Find instance by tag
  // ============================================

  log('Finding tunnel server instance...')

  const instances = await ec2.describeInstances({
    Filters: [
      { Name: 'tag:Project', Values: ['localtunnels'] },
      { Name: 'tag:Name', Values: [`${prefix}-tunnel-server`] },
      { Name: 'instance-state-name', Values: ['running', 'stopped', 'pending'] },
    ],
  })

  const instance = instances.Reservations?.[0]?.Instances?.[0]
  const instanceId = instance?.InstanceId

  if (!instanceId) {
    log('No tunnel server instance found')
  }
  else {
    log(`Found instance: ${instanceId}`)
  }

  // ============================================
  // Step 2: Find and release Elastic IP
  // ============================================

  log('Finding Elastic IP...')

  const addresses = await ec2.describeAddresses({
    Filters: [
      { Name: 'tag:Project', Values: ['localtunnels'] },
      { Name: 'tag:Name', Values: [`${prefix}-tunnel-eip`] },
    ],
  })

  const address = addresses.Addresses?.[0]
  if (address) {
    log(`Found Elastic IP: ${address.PublicIp} (${address.AllocationId})`)

    // Disassociate if associated
    if (address.AssociationId) {
      log('Disassociating Elastic IP...')
      try {
        await ec2.disassociateAddress(address.AssociationId)
        log('Elastic IP disassociated')
      }
      catch (error: any) {
        log(`Warning: Could not disassociate Elastic IP: ${error.message}`)
      }
    }

    // Release the Elastic IP
    if (address.AllocationId) {
      log('Releasing Elastic IP...')
      try {
        await ec2.releaseAddress(address.AllocationId)
        log('Elastic IP released')
      }
      catch (error: any) {
        log(`Warning: Could not release Elastic IP: ${error.message}`)
      }
    }
  }
  else {
    log('No Elastic IP found')
  }

  // ============================================
  // Step 3: Terminate instance
  // ============================================

  if (instanceId) {
    log('Terminating instance...')
    await ec2.terminateInstances([instanceId])
    log('Waiting for instance to terminate...')
    await ec2.waitForInstanceState(instanceId, 'terminated', {
      maxWaitMs: 120000,
      pollIntervalMs: 5000,
    })
    log('Instance terminated')
  }

  // ============================================
  // Step 4: Delete security group
  // ============================================

  const sgName = `${prefix}-tunnel-sg`
  log(`Finding security group: ${sgName}...`)

  const sgs = await ec2.describeSecurityGroups({
    Filters: [
      { Name: 'group-name', Values: [sgName] },
    ],
  })

  const sg = sgs.SecurityGroups?.[0]
  if (sg?.GroupId) {
    log(`Deleting security group: ${sg.GroupId}...`)
    try {
      await ec2.deleteSecurityGroup(sg.GroupId)
      log('Security group deleted')
    }
    catch (error: any) {
      log(`Warning: Could not delete security group: ${error.message}`)
      log('It may still be in use. Try again in a few minutes after the instance is fully terminated.')
    }
  }
  else {
    log('No security group found')
  }

  // ============================================
  // Step 5: Clean up Route53 DNS records
  // ============================================

  if (config.domain) {
    log(`Cleaning up Route53 DNS records for ${config.domain}...`)
    try {
      const route53 = new Route53Client(region)

      let hostedZoneId = config.hostedZoneId
      if (!hostedZoneId) {
        const zone = await route53.findHostedZoneForDomain(config.domain)
        hostedZoneId = zone?.Id?.replace('/hostedzone/', '')
      }

      if (hostedZoneId) {
        // Delete the A record for the domain
        try {
          await route53.deleteRecord({
            HostedZoneId: hostedZoneId,
            Name: config.domain,
            Type: 'A',
          })
          log(`Deleted A record: ${config.domain}`)
        }
        catch (error: any) {
          log(`Warning: Could not delete A record for ${config.domain}: ${error.message}`)
        }

        // Delete the wildcard A record
        try {
          await route53.deleteRecord({
            HostedZoneId: hostedZoneId,
            Name: `*.${config.domain}`,
            Type: 'A',
          })
          log(`Deleted A record: *.${config.domain}`)
        }
        catch (error: any) {
          log(`Warning: Could not delete wildcard A record: ${error.message}`)
        }
      }
      else {
        log(`Warning: Could not find Route53 hosted zone for ${config.domain}`)
      }
    }
    catch (error: any) {
      log(`Warning: DNS cleanup failed: ${error.message}`)
    }
  }

  log('Destruction complete!')
}

/**
 * Generate the EC2 user data script that installs Bun, localtunnels,
 * and sets up a systemd service running the TunnelServer.
 */
function generateUserData(port: number): string {
  const serverScript = [
    'import { TunnelServer } from \'localtunnels\'',
    '',
    'const server = new TunnelServer({',
    `  port: ${port},`,
    '  host: \'0.0.0.0\',',
    '  verbose: true,',
    '})',
    '',
    'server.on(\'connection\', (info) => {',
    '  console.log(\'+ Client connected: \' + info.subdomain)',
    '})',
    '',
    'server.on(\'disconnection\', (info) => {',
    '  console.log(\'- Client disconnected: \' + info.subdomain)',
    '})',
    '',
    'await server.start()',
    `console.log('LocalTunnel server is running on port ${port}')`,
  ].join('\n')

  return [
    '#!/bin/bash',
    'set -ex',
    '',
    '# Set HOME explicitly (cloud-init does not always set it)',
    'export HOME=/root',
    '',
    '# Install Bun',
    'export BUN_INSTALL="/root/.bun"',
    'curl -fsSL https://bun.sh/install | bash',
    'export PATH="$BUN_INSTALL/bin:$PATH"',
    '',
    '# Create app directory',
    'mkdir -p /opt/localtunnel',
    'cd /opt/localtunnel',
    '',
    '# Install localtunnels',
    '/root/.bun/bin/bun init -y',
    '/root/.bun/bin/bun add localtunnels',
    '',
    '# Create server script',
    'cat > server.ts << \'SERVERSCRIPT\'',
    serverScript,
    'SERVERSCRIPT',
    '',
    '# Create systemd service',
    'cat > /etc/systemd/system/localtunnel.service << \'SERVICEUNIT\'',
    '[Unit]',
    'Description=LocalTunnel Server',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    'WorkingDirectory=/opt/localtunnel',
    'Environment=BUN_INSTALL=/root/.bun',
    'Environment=PATH=/root/.bun/bin:/usr/local/bin:/usr/bin:/bin',
    'ExecStart=/root/.bun/bin/bun run server.ts',
    'Restart=always',
    'RestartSec=5',
    'StandardOutput=journal',
    'StandardError=journal',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    'SERVICEUNIT',
    '',
    'systemctl daemon-reload',
    'systemctl enable localtunnel',
    'systemctl start localtunnel',
    '',
  ].join('\n')
}
