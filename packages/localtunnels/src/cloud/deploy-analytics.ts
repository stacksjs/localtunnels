/**
 * LocalTunnels Analytics Backend Deployment
 *
 * Deploys the ts-analytics backend infrastructure:
 * - DynamoDB table (single-table design with GSIs, TTL, PITR)
 * - Lambda function with Bun runtime (API handler)
 * - API Gateway HTTP API (collect endpoint)
 *
 * Uses ts-cloud for CloudFormation deployment and ts-analytics
 * for template generation and Lambda handler bundling.
 */

export interface AnalyticsDeployConfig {
  /**
   * AWS region
   * @default 'us-east-1'
   */
  region?: string

  /**
   * DynamoDB table name
   * @default 'ts-analytics'
   */
  tableName?: string

  /**
   * Service name prefix for Lambda + API Gateway resources
   * @default 'localtunnel-analytics'
   */
  serviceName?: string

  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean
}

export interface AnalyticsDeployResult {
  success: boolean
  apiEndpoint: string
  tableName: string
  region: string
  message: string
}

/**
 * Deploy the analytics backend (DynamoDB + Lambda + API Gateway).
 */
export async function deployAnalytics(config: AnalyticsDeployConfig = {}): Promise<AnalyticsDeployResult> {
  let CloudFormationClient: any
  let S3Client: any

  try {
    const tsCloud = await import('@stacksjs/ts-cloud')
    CloudFormationClient = tsCloud.CloudFormationClient
    S3Client = tsCloud.S3Client
  }
  catch {
    throw new Error(
      '@stacksjs/ts-cloud package is required for analytics deployment.\n'
      + 'Install it with: bun add @stacksjs/ts-cloud',
    )
  }

  let generateCloudFormationJson: any

  try {
    const tsAnalytics = await import('@stacksjs/ts-analytics')
    generateCloudFormationJson = tsAnalytics.generateCloudFormationJson
  }
  catch {
    throw new Error(
      '@stacksjs/ts-analytics package is required for analytics deployment.\n'
      + 'Install it with: bun add @stacksjs/ts-analytics',
    )
  }

  const region = config.region || 'us-east-1'
  const tableName = config.tableName || 'ts-analytics'
  const serviceName = config.serviceName || 'localtunnel-analytics'
  const verbose = config.verbose || false
  const dbStackName = `${tableName}-stack`
  const apiStackName = `${serviceName}-lambda-stack`
  const bucketName = `${serviceName}-deployment-${region}`

  const log = (msg: string) => {
    if (verbose)
      console.log(`[deploy:analytics] ${msg}`)
  }

  const cfn = new CloudFormationClient(region)
  const s3 = new S3Client(region)

  // ── Step 1: Deploy DynamoDB table ──────────────────────────────────────

  log('Deploying DynamoDB table...')
  console.log(`  [1/4] Deploying DynamoDB table: ${tableName}`)

  const dbTemplate = generateCloudFormationJson({
    stackName: dbStackName,
    tableName,
    billingMode: 'PAY_PER_REQUEST',
    enablePitr: true,
    enableEncryption: true,
    ttlAttributeName: 'ttl',
    tags: {
      Project: 'localtunnels',
      ManagedBy: 'ts-cloud',
    },
  })

  await deployOrUpdateStack(cfn, dbStackName, dbTemplate, [], log)
  console.log(`  ✓ DynamoDB table deployed`)

  // ── Step 2: Create S3 bucket for Lambda artifacts ─────────────────────

  log('Setting up deployment bucket...')
  console.log(`  [2/4] Setting up deployment bucket: ${bucketName}`)

  try {
    const bucketExists = await s3.headBucket(bucketName)
    if (!bucketExists.exists) {
      await s3.createBucket(bucketName)
      log(`Created S3 bucket: ${bucketName}`)
      // Wait for bucket to be available (S3 eventual consistency)
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    else {
      log(`Using existing bucket: ${bucketName}`)
    }
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('already owned') && !message.includes('BucketAlreadyOwnedByYou')) {
      throw error
    }
    log(`Bucket already exists: ${bucketName}`)
  }

  console.log(`  ✓ Deployment bucket ready`)

  // ── Step 3: Bundle and upload Lambda handler ──────────────────────────

  log('Bundling Lambda function...')
  console.log(`  [3/4] Bundling and uploading Lambda function...`)

  // Find the ts-analytics lambda-handler source
  const tsAnalyticsPath = require.resolve('@stacksjs/ts-analytics').replace(/\/dist\/.*$|\/src\/.*$/, '')
  const handlerPath = `${tsAnalyticsPath}/deploy/lambda-handler.ts`
  const handlerFile = Bun.file(handlerPath)

  if (!await handlerFile.exists()) {
    throw new Error(
      `ts-analytics lambda-handler not found at ${handlerPath}.\n`
      + 'Ensure @stacksjs/ts-analytics is installed with source files.',
    )
  }

  const bundleResult = await Bun.build({
    entrypoints: [handlerPath],
    outdir: './dist/analytics-lambda',
    target: 'bun',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
    external: [
      '@stacksjs/stx',
      'bun-plugin-stx',
    ],
  })

  if (!bundleResult.success) {
    console.error('Bundle errors:', bundleResult.logs)
    throw new Error('Failed to bundle analytics Lambda function')
  }

  log('Bundled successfully')

  // Create zip
  const fs = await import('node:fs')
  const path = await import('node:path')
  const jsPath = './dist/analytics-lambda/lambda-handler.js'
  const zipPath = './dist/analytics-lambda/function.zip'
  const absoluteZipPath = path.resolve(zipPath)
  const absoluteJsPath = path.resolve(jsPath)

  try { fs.unlinkSync(zipPath) }
  catch { /* ignore */ }

  const proc = Bun.spawn(['zip', '-j', absoluteZipPath, absoluteJsPath], {
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await proc.exited

  if (proc.exitCode !== 0) {
    throw new Error('Failed to create Lambda zip file')
  }

  // Upload to S3
  const zipBuffer = await Bun.file(zipPath).arrayBuffer()
  const s3Key = `lambda/${serviceName}-${Date.now()}.zip`

  await s3.putObject({
    bucket: bucketName,
    key: s3Key,
    body: Buffer.from(zipBuffer),
    contentType: 'application/zip',
  })

  log(`Uploaded to s3://${bucketName}/${s3Key}`)
  console.log(`  ✓ Lambda function uploaded`)

  // ── Step 4: Deploy Lambda + API Gateway stack ─────────────────────────

  log('Deploying Lambda and API Gateway...')
  console.log(`  [4/4] Deploying Lambda + API Gateway...`)

  const apiTemplate = JSON.stringify({
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'localtunnel-analytics API (Lambda + API Gateway)',

    Parameters: {
      S3Bucket: { Type: 'String', Default: bucketName },
      S3Key: { Type: 'String', Default: s3Key },
      TableName: { Type: 'String', Default: tableName },
    },

    Resources: {
      LambdaRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'lambda.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          },
          ManagedPolicyArns: [
            'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          ],
          Policies: [
            {
              PolicyName: 'DynamoDBAccess',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  {
                    Effect: 'Allow',
                    Action: [
                      'dynamodb:GetItem',
                      'dynamodb:PutItem',
                      'dynamodb:UpdateItem',
                      'dynamodb:DeleteItem',
                      'dynamodb:Query',
                      'dynamodb:Scan',
                    ],
                    Resource: [
                      { 'Fn::Sub': 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${TableName}' },
                      { 'Fn::Sub': 'arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${TableName}/index/*' },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },

      LambdaFunction: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          FunctionName: serviceName,
          Runtime: 'provided.al2023',
          Handler: 'lambda-handler.fetch',
          Architectures: ['arm64'],
          Layers: [
            `arn:aws:lambda:${region}:923076644019:layer:bun-runtime:1`,
          ],
          Code: {
            S3Bucket: { Ref: 'S3Bucket' },
            S3Key: { Ref: 'S3Key' },
          },
          Role: { 'Fn::GetAtt': ['LambdaRole', 'Arn'] },
          MemorySize: 256,
          Timeout: 30,
          Environment: {
            Variables: {
              ANALYTICS_TABLE_NAME: { Ref: 'TableName' },
            },
          },
        },
      },

      HttpApi: {
        Type: 'AWS::ApiGatewayV2::Api',
        Properties: {
          Name: `${serviceName}-api`,
          ProtocolType: 'HTTP',
          CorsConfiguration: {
            AllowOrigins: ['*'],
            AllowMethods: ['GET', 'POST', 'OPTIONS'],
            AllowHeaders: ['Content-Type'],
            MaxAge: 86400,
          },
        },
      },

      LambdaIntegration: {
        Type: 'AWS::ApiGatewayV2::Integration',
        Properties: {
          ApiId: { Ref: 'HttpApi' },
          IntegrationType: 'AWS_PROXY',
          IntegrationUri: { 'Fn::GetAtt': ['LambdaFunction', 'Arn'] },
          PayloadFormatVersion: '2.0',
        },
      },

      DefaultRoute: {
        Type: 'AWS::ApiGatewayV2::Route',
        Properties: {
          ApiId: { Ref: 'HttpApi' },
          RouteKey: '$default',
          Target: { 'Fn::Join': ['/', ['integrations', { Ref: 'LambdaIntegration' }]] },
        },
      },

      ApiStage: {
        Type: 'AWS::ApiGatewayV2::Stage',
        Properties: {
          ApiId: { Ref: 'HttpApi' },
          StageName: '$default',
          AutoDeploy: true,
        },
      },

      LambdaPermission: {
        Type: 'AWS::Lambda::Permission',
        Properties: {
          FunctionName: { Ref: 'LambdaFunction' },
          Action: 'lambda:InvokeFunction',
          Principal: 'apigateway.amazonaws.com',
          SourceArn: { 'Fn::Sub': 'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${HttpApi}/*' },
        },
      },
    },

    Outputs: {
      ApiEndpoint: {
        Description: 'API Gateway endpoint URL',
        Value: { 'Fn::GetAtt': ['HttpApi', 'ApiEndpoint'] },
      },
      LambdaArn: {
        Description: 'Lambda function ARN',
        Value: { 'Fn::GetAtt': ['LambdaFunction', 'Arn'] },
      },
    },
  })

  await deployOrUpdateStack(cfn, apiStackName, apiTemplate, ['CAPABILITY_IAM'], log)

  // Get outputs
  const outputs = await cfn.getStackOutputs(apiStackName)
  const apiEndpoint = outputs.ApiEndpoint

  console.log(`  ✓ API Gateway deployed`)

  // Test health
  try {
    const healthResponse = await fetch(`${apiEndpoint}/health`)
    const healthData = await healthResponse.json()
    log(`Health check: ${JSON.stringify(healthData)}`)
  }
  catch {
    log('Health check failed (Lambda may still be initializing)')
  }

  return {
    success: true,
    apiEndpoint,
    tableName,
    region,
    message: `Analytics backend deployed. API endpoint: ${apiEndpoint}`,
  }
}

/**
 * Destroy the analytics infrastructure (DynamoDB table + Lambda + API Gateway).
 */
export async function destroyAnalytics(config: Pick<AnalyticsDeployConfig, 'region' | 'tableName' | 'serviceName' | 'verbose'> = {}): Promise<void> {
  let CloudFormationClient: any

  try {
    const tsCloud = await import('@stacksjs/ts-cloud')
    CloudFormationClient = tsCloud.CloudFormationClient
  }
  catch {
    throw new Error(
      '@stacksjs/ts-cloud package is required.\n'
      + 'Install it with: bun add @stacksjs/ts-cloud',
    )
  }

  const region = config.region || 'us-east-1'
  const tableName = config.tableName || 'ts-analytics'
  const serviceName = config.serviceName || 'localtunnel-analytics'
  const verbose = config.verbose || false
  const dbStackName = `${tableName}-stack`
  const apiStackName = `${serviceName}-lambda-stack`

  const log = (msg: string) => {
    if (verbose)
      console.log(`[destroy:analytics] ${msg}`)
  }

  const cfn = new CloudFormationClient(region)

  // Delete API stack first (depends on DynamoDB table)
  console.log(`  Deleting API stack: ${apiStackName}...`)
  try {
    await cfn.deleteStack({ stackName: apiStackName })
    await cfn.waitForStack(apiStackName, 'stack-delete-complete')
    console.log(`  ✓ API stack deleted`)
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('does not exist')) {
      log('API stack does not exist, skipping')
    }
    else {
      throw error
    }
  }

  // Delete DynamoDB stack
  console.log(`  Deleting DynamoDB stack: ${dbStackName}...`)
  try {
    await cfn.deleteStack({ stackName: dbStackName })
    await cfn.waitForStack(dbStackName, 'stack-delete-complete')
    console.log(`  ✓ DynamoDB stack deleted`)
  }
  catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('does not exist')) {
      log('DynamoDB stack does not exist, skipping')
    }
    else {
      throw error
    }
  }

  log('Analytics infrastructure destroyed')
}

/**
 * Helper: create or update a CloudFormation stack.
 */
async function deployOrUpdateStack(
  cfn: any,
  stackName: string,
  templateBody: string,
  capabilities: string[],
  log: (msg: string) => void,
): Promise<void> {
  let stackExists = false

  try {
    const existingStacks = await cfn.describeStacks({ stackName })
    if (existingStacks.Stacks.length > 0) {
      stackExists = true
      const status = existingStacks.Stacks[0].StackStatus

      if (status.endsWith('_IN_PROGRESS')) {
        log(`Stack ${stackName} is in progress: ${status}, waiting...`)
        await cfn.waitForStack(stackName, 'stack-update-complete')
        return
      }
    }
  }
  catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    if (!msg.includes('does not exist')) {
      throw error
    }
  }

  if (stackExists) {
    log(`Updating stack: ${stackName}`)
    try {
      await cfn.updateStack({
        stackName,
        templateBody,
        ...(capabilities.length > 0 ? { capabilities } : {}),
      })
      await cfn.waitForStack(stackName, 'stack-update-complete')
    }
    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('No updates')) {
        log('Stack is up to date')
      }
      else {
        throw error
      }
    }
  }
  else {
    log(`Creating stack: ${stackName}`)
    await cfn.createStack({
      stackName,
      templateBody,
      ...(capabilities.length > 0 ? { capabilities } : {}),
      tags: [
        { Key: 'Project', Value: 'localtunnels' },
        { Key: 'ManagedBy', Value: 'ts-cloud' },
      ],
    })
    await cfn.waitForStack(stackName, 'stack-create-complete')
  }
}
