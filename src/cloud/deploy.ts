/**
 * LocalTunnels Cloud Deployment
 * Uses ts-cloud for AWS infrastructure deployment
 *
 * This module deploys:
 * - DynamoDB tables for connection tracking and responses
 * - Lambda functions for WebSocket and HTTP handling
 * - Lambda Function URLs for public access
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
   * Domain name for the tunnel service
   * @default 'localtunnel.dev'
   */
  domain?: string

  /**
   * Enable verbose logging during deployment
   * @default false
   */
  verbose?: boolean

  /**
   * IAM role ARN for Lambda functions
   * If not provided, will attempt to create one
   */
  lambdaRoleArn?: string
}

export interface TunnelDeployResult {
  /**
   * URL for the HTTP endpoint (Lambda Function URL)
   */
  httpUrl: string

  /**
   * URL for the WebSocket endpoint (Lambda Function URL)
   */
  wsUrl: string

  /**
   * DynamoDB connections table name
   */
  connectionsTable: string

  /**
   * DynamoDB responses table name
   */
  responsesTable: string

  /**
   * Lambda function names
   */
  functions: {
    connect: string
    disconnect: string
    message: string
    http: string
  }

  /**
   * AWS region
   */
  region: string
}

/**
 * Deploy the tunnel infrastructure to AWS
 */
export async function deployTunnelInfrastructure(
  config: TunnelDeployConfig = {},
): Promise<TunnelDeployResult> {
  // Dynamic import ts-cloud to avoid bundling issues
  let DynamoDBClient: any, LambdaClient: any, IAMClient: any

  try {
    const tsCloud = await import('ts-cloud')
    DynamoDBClient = tsCloud.DynamoDBClient
    LambdaClient = tsCloud.LambdaClient
    IAMClient = tsCloud.IAMClient
  }
  catch {
    throw new Error(
      'ts-cloud package is required for AWS deployment.\n'
      + 'Install it with: bun add ts-cloud\n'
      + 'Or from source: bun add ts-cloud@link:../path/to/ts-cloud',
    )
  }

  const region = config.region || 'us-east-1'
  const prefix = config.prefix || 'localtunnel'
  const verbose = config.verbose || false

  const log = (msg: string) => {
    if (verbose)
      console.log(`[deploy] ${msg}`)
  }

  const dynamodb = new DynamoDBClient(region)
  const lambda = new LambdaClient(region)
  const iam = new IAMClient(region)

  // Resource names
  const connectionsTableName = `${prefix}-connections`
  const responsesTableName = `${prefix}-responses`
  const connectFunctionName = `${prefix}-connect`
  const disconnectFunctionName = `${prefix}-disconnect`
  const messageFunctionName = `${prefix}-message`
  const httpFunctionName = `${prefix}-http`

  // ============================================
  // Step 1: Create DynamoDB Tables
  // ============================================

  log('Creating DynamoDB tables...')

  // Connections table
  try {
    await dynamodb.createTable({
      TableName: connectionsTableName,
      KeySchema: [
        { AttributeName: 'connectionId', KeyType: 'HASH' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'connectionId', AttributeType: 'S' },
        { AttributeName: 'subdomain', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
      GlobalSecondaryIndexes: [
        {
          IndexName: 'subdomain-index',
          KeySchema: [
            { AttributeName: 'subdomain', KeyType: 'HASH' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
      Tags: [
        { Key: 'Project', Value: 'localtunnels' },
      ],
    })
    log(`Created table: ${connectionsTableName}`)

    // Enable TTL
    await dynamodb.updateTimeToLive({
      TableName: connectionsTableName,
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    })
    log(`Enabled TTL on: ${connectionsTableName}`)
  }
  catch (error: any) {
    if (error.message?.includes('Table already exists') || error.__type?.includes('ResourceInUseException')) {
      log(`Table ${connectionsTableName} already exists`)
    }
    else {
      throw error
    }
  }

  // Responses table
  try {
    await dynamodb.createTable({
      TableName: responsesTableName,
      KeySchema: [
        { AttributeName: 'requestId', KeyType: 'HASH' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'requestId', AttributeType: 'S' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
      Tags: [
        { Key: 'Project', Value: 'localtunnels' },
      ],
    })
    log(`Created table: ${responsesTableName}`)

    // Enable TTL
    await dynamodb.updateTimeToLive({
      TableName: responsesTableName,
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    })
    log(`Enabled TTL on: ${responsesTableName}`)
  }
  catch (error: any) {
    if (error.message?.includes('Table already exists') || error.__type?.includes('ResourceInUseException')) {
      log(`Table ${responsesTableName} already exists`)
    }
    else {
      throw error
    }
  }

  // Wait for tables to be active
  log('Waiting for tables to be active...')
  await waitForTableActive(dynamodb, connectionsTableName)
  await waitForTableActive(dynamodb, responsesTableName)

  // ============================================
  // Step 2: Create or Get IAM Role
  // ============================================

  let lambdaRoleArn = config.lambdaRoleArn

  if (!lambdaRoleArn) {
    log('Creating IAM role for Lambda...')
    const roleName = `${prefix}-lambda-role`

    try {
      const createRoleResult = await iam.createRole({
        RoleName: roleName,
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        }),
        Description: 'IAM role for LocalTunnels Lambda functions',
      })
      lambdaRoleArn = createRoleResult.Role?.Arn

      // Attach policies
      await iam.attachRolePolicy({
        RoleName: roleName,
        PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      })

      // Create custom policy for DynamoDB access
      const policyDocument = {
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
              `arn:aws:dynamodb:${region}:*:table/${connectionsTableName}`,
              `arn:aws:dynamodb:${region}:*:table/${connectionsTableName}/index/*`,
              `arn:aws:dynamodb:${region}:*:table/${responsesTableName}`,
            ],
          },
        ],
      }

      await iam.putRolePolicy({
        RoleName: roleName,
        PolicyName: `${prefix}-dynamodb-policy`,
        PolicyDocument: JSON.stringify(policyDocument),
      })

      log(`Created IAM role: ${roleName}`)

      // Wait for role to propagate
      await new Promise(resolve => setTimeout(resolve, 10000))
    }
    catch (error: any) {
      if (error.message?.includes('EntityAlreadyExists')) {
        const getRole = await iam.getRole({ RoleName: roleName })
        lambdaRoleArn = getRole.Role?.Arn
        log(`Using existing IAM role: ${roleName}`)
      }
      else {
        throw error
      }
    }
  }

  if (!lambdaRoleArn) {
    throw new Error('Failed to create or find Lambda IAM role')
  }

  // ============================================
  // Step 3: Create Lambda Functions
  // ============================================

  log('Creating Lambda functions...')

  const handlerCode = generateHandlerCode(connectionsTableName, responsesTableName)

  // HTTP Handler Function
  const _httpFunction = await createOrUpdateFunction(lambda, {
    FunctionName: httpFunctionName,
    Runtime: 'nodejs20.x',
    Role: lambdaRoleArn,
    Handler: 'index.handler',
    Code: handlerCode.http,
    Description: 'LocalTunnels HTTP request handler',
    Timeout: 30,
    MemorySize: 256,
    Environment: {
      Variables: {
        TABLE_NAME: connectionsTableName,
        RESPONSE_TABLE_NAME: responsesTableName,
      },
    },
  })
  log(`Created/updated function: ${httpFunctionName}`)

  // Create Function URL for HTTP handler
  let httpUrl = ''
  try {
    const existingUrl = await lambda.getFunctionUrl(httpFunctionName)
    if (existingUrl?.FunctionUrl) {
      httpUrl = existingUrl.FunctionUrl
    }
    else {
      const urlConfig = await lambda.createFunctionUrl({
        FunctionName: httpFunctionName,
        AuthType: 'NONE',
        Cors: {
          AllowOrigins: ['*'],
          AllowMethods: ['*'],
          AllowHeaders: ['*'],
          MaxAge: 86400,
        },
      })
      httpUrl = urlConfig.FunctionUrl || ''

      // Add permission for public access
      await lambda.addFunctionUrlPermission(httpFunctionName)
    }
  }
  catch (error: any) {
    log(`Warning: Could not create function URL for HTTP handler: ${error.message}`)
  }

  // WebSocket-like Handler (using Lambda Function URL with streaming)
  // Note: For true WebSocket support, you'd use API Gateway WebSocket API
  // This is a simplified HTTP-based approach
  const _wsFunction = await createOrUpdateFunction(lambda, {
    FunctionName: messageFunctionName,
    Runtime: 'nodejs20.x',
    Role: lambdaRoleArn,
    Handler: 'index.handler',
    Code: handlerCode.message,
    Description: 'LocalTunnels WebSocket message handler',
    Timeout: 30,
    MemorySize: 256,
    Environment: {
      Variables: {
        TABLE_NAME: connectionsTableName,
        RESPONSE_TABLE_NAME: responsesTableName,
      },
    },
  })
  log(`Created/updated function: ${messageFunctionName}`)

  // Create Function URL for WebSocket handler
  let wsUrl = ''
  try {
    const existingUrl = await lambda.getFunctionUrl(messageFunctionName)
    if (existingUrl?.FunctionUrl) {
      wsUrl = existingUrl.FunctionUrl
    }
    else {
      const urlConfig = await lambda.createFunctionUrl({
        FunctionName: messageFunctionName,
        AuthType: 'NONE',
        Cors: {
          AllowOrigins: ['*'],
          AllowMethods: ['*'],
          AllowHeaders: ['*'],
        },
      })
      wsUrl = urlConfig.FunctionUrl || ''

      await lambda.addFunctionUrlPermission(messageFunctionName)
    }
  }
  catch (error: any) {
    log(`Warning: Could not create function URL for message handler: ${error.message}`)
  }

  log('Deployment complete!')

  return {
    httpUrl,
    wsUrl,
    connectionsTable: connectionsTableName,
    responsesTable: responsesTableName,
    functions: {
      connect: connectFunctionName,
      disconnect: disconnectFunctionName,
      message: messageFunctionName,
      http: httpFunctionName,
    },
    region,
  }
}

/**
 * Destroy the tunnel infrastructure
 */
export async function destroyTunnelInfrastructure(
  config: TunnelDeployConfig = {},
): Promise<void> {
  let DynamoDBClient: any, LambdaClient: any, IAMClient: any

  try {
    const tsCloud = await import('ts-cloud')
    DynamoDBClient = tsCloud.DynamoDBClient
    LambdaClient = tsCloud.LambdaClient
    IAMClient = tsCloud.IAMClient
  }
  catch {
    throw new Error(
      'ts-cloud package is required for AWS deployment.\n'
      + 'Install it with: bun add ts-cloud\n'
      + 'Or from source: bun add ts-cloud@link:../path/to/ts-cloud',
    )
  }

  const region = config.region || 'us-east-1'
  const prefix = config.prefix || 'localtunnel'
  const verbose = config.verbose || false

  const log = (msg: string) => {
    if (verbose)
      console.log(`[destroy] ${msg}`)
  }

  const dynamodb = new DynamoDBClient(region)
  const lambda = new LambdaClient(region)
  const iam = new IAMClient(region)

  // Resource names
  const connectionsTableName = `${prefix}-connections`
  const responsesTableName = `${prefix}-responses`
  const messageFunctionName = `${prefix}-message`
  const httpFunctionName = `${prefix}-http`
  const roleName = `${prefix}-lambda-role`

  // Delete Lambda functions
  log('Deleting Lambda functions...')
  for (const fnName of [messageFunctionName, httpFunctionName]) {
    try {
      await lambda.deleteFunctionUrl(fnName)
      log(`Deleted function URL: ${fnName}`)
    }
    catch {
      // Ignore
    }
    try {
      await lambda.deleteFunction(fnName)
      log(`Deleted function: ${fnName}`)
    }
    catch (error: any) {
      if (!error.message?.includes('ResourceNotFoundException')) {
        log(`Warning: Could not delete function ${fnName}: ${error.message}`)
      }
    }
  }

  // Delete DynamoDB tables
  log('Deleting DynamoDB tables...')
  for (const tableName of [connectionsTableName, responsesTableName]) {
    try {
      await dynamodb.deleteTable({ TableName: tableName })
      log(`Deleted table: ${tableName}`)
    }
    catch (error: any) {
      if (!error.message?.includes('ResourceNotFoundException')) {
        log(`Warning: Could not delete table ${tableName}: ${error.message}`)
      }
    }
  }

  // Delete IAM role (if we created it)
  if (!config.lambdaRoleArn) {
    log('Deleting IAM role...')
    try {
      // Detach policies first
      await iam.detachRolePolicy({
        RoleName: roleName,
        PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      })
      await iam.deleteRolePolicy({
        RoleName: roleName,
        PolicyName: `${prefix}-dynamodb-policy`,
      })
      await iam.deleteRole({ RoleName: roleName })
      log(`Deleted IAM role: ${roleName}`)
    }
    catch (error: any) {
      log(`Warning: Could not delete IAM role: ${error.message}`)
    }
  }

  log('Destruction complete!')
}

/**
 * Wait for a DynamoDB table to become active
 */
async function waitForTableActive(
  dynamodb: any,
  tableName: string,
  maxWaitMs: number = 60000,
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const result = await dynamodb.describeTable({ TableName: tableName })
      if (result.Table?.TableStatus === 'ACTIVE') {
        return
      }
    }
    catch {
      // Table might not exist yet
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error(`Timeout waiting for table ${tableName} to become active`)
}

/**
 * Create or update a Lambda function
 */
async function createOrUpdateFunction(
  lambda: any,
  params: {
    FunctionName: string
    Runtime: string
    Role: string
    Handler: string
    Code: string
    Description?: string
    Timeout?: number
    MemorySize?: number
    Environment?: { Variables: Record<string, string> }
  },
): Promise<any> {
  const exists = await lambda.functionExists(params.FunctionName)

  if (exists) {
    // Update existing function
    await lambda.updateFunctionCodeInline(params.FunctionName, params.Code, 'index.js')
    await lambda.updateFunctionConfiguration({
      FunctionName: params.FunctionName,
      Runtime: params.Runtime,
      Handler: params.Handler,
      Description: params.Description,
      Timeout: params.Timeout,
      MemorySize: params.MemorySize,
      Environment: params.Environment,
    })
    return lambda.getFunction(params.FunctionName)
  }
  else {
    // Create new function
    return lambda.createFunctionWithCode({
      FunctionName: params.FunctionName,
      Runtime: params.Runtime,
      Role: params.Role,
      Handler: params.Handler,
      Code: params.Code,
      Description: params.Description,
      Timeout: params.Timeout,
      MemorySize: params.MemorySize,
      Environment: params.Environment,
    })
  }
}

/**
 * Generate Lambda handler code
 */
function generateHandlerCode(
  _connectionsTable: string,
  _responsesTable: string,
): { http: string, message: string } {
  const httpCode = `
const { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;
const RESPONSE_TABLE_NAME = process.env.RESPONSE_TABLE_NAME;

exports.handler = async (event) => {
  const host = event.headers?.host || '';
  const subdomain = host.split('.')[0];
  const path = event.rawPath || '/';
  const method = event.requestContext?.http?.method || 'GET';

  // Health check
  if (path === '/health' || path === '/_health') {
    return { statusCode: 200, body: 'OK' };
  }

  // Status endpoint
  if (path === '/status' || path === '/_status') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', version: '0.2.0' }),
    };
  }

  if (!subdomain) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid subdomain' }) };
  }

  try {
    // Find connection for subdomain
    const connections = await dynamodb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'subdomain-index',
      KeyConditionExpression: 'subdomain = :subdomain',
      ExpressionAttributeValues: { ':subdomain': { S: subdomain } },
    }));

    if (!connections.Items?.length) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Tunnel not found', subdomain }),
      };
    }

    // For now, return a message indicating the tunnel exists
    // Full implementation would forward to the connected client
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Tunnel active',
        subdomain,
        note: 'Connect using WebSocket client for full functionality',
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
`

  const messageCode = `
const { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, QueryCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME;
const RESPONSE_TABLE_NAME = process.env.RESPONSE_TABLE_NAME;

exports.handler = async (event) => {
  const body = event.body ? JSON.parse(event.body) : {};
  const { type, subdomain, id, status, headers, responseBody } = body;

  try {
    switch (type) {
      case 'register': {
        // Register a new tunnel client
        const connectionId = \`conn_\${Date.now()}_\${Math.random().toString(36).substr(2, 9)}\`;

        await dynamodb.send(new PutItemCommand({
          TableName: TABLE_NAME,
          Item: {
            connectionId: { S: connectionId },
            subdomain: { S: subdomain },
            connectedAt: { N: Date.now().toString() },
            lastSeen: { N: Date.now().toString() },
            ttl: { N: Math.floor(Date.now() / 1000 + 86400).toString() },
          },
        }));

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'registered',
            connectionId,
            subdomain,
            url: \`https://\${subdomain}.localtunnel.dev\`,
          }),
        };
      }

      case 'response': {
        // Store a response from the tunnel client
        await dynamodb.send(new PutItemCommand({
          TableName: RESPONSE_TABLE_NAME,
          Item: {
            requestId: { S: id },
            status: { N: (status || 200).toString() },
            headers: { S: JSON.stringify(headers || {}) },
            body: { S: responseBody || '' },
            ttl: { N: Math.floor(Date.now() / 1000 + 60).toString() },
          },
        }));

        return {
          statusCode: 200,
          body: JSON.stringify({ type: 'response_stored', id }),
        };
      }

      case 'ping': {
        // Update last seen timestamp
        if (body.connectionId) {
          await dynamodb.send(new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: { connectionId: { S: body.connectionId } },
            UpdateExpression: 'SET lastSeen = :now',
            ExpressionAttributeValues: { ':now': { N: Date.now().toString() } },
          }));
        }

        return {
          statusCode: 200,
          body: JSON.stringify({ type: 'pong' }),
        };
      }

      case 'disconnect': {
        // Remove connection
        if (body.connectionId) {
          await dynamodb.send(new DeleteItemCommand({
            TableName: TABLE_NAME,
            Key: { connectionId: { S: body.connectionId } },
          }));
        }

        return {
          statusCode: 200,
          body: JSON.stringify({ type: 'disconnected' }),
        };
      }

      default:
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Unknown message type', type }),
        };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
`

  return { http: httpCode, message: messageCode }
}
