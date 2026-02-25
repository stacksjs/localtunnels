/**
 * Lambda handler for WebSocket messages
 * Uses ts-cloud DynamoDBClient instead of @aws-sdk
 *
 * Note: These Lambda handlers are part of the legacy Lambda+DynamoDB architecture.
 * The primary deployment now uses EC2 with TunnelServer directly.
 */

export async function handler(event: any): Promise<any> {
  const { DynamoDBClient } = await import('@stacksjs/ts-cloud')

  const dynamodb = new DynamoDBClient(process.env.AWS_REGION || 'us-east-1')
  const TABLE_NAME = process.env.TABLE_NAME!
  const RESPONSE_TABLE_NAME = process.env.RESPONSE_TABLE_NAME!

  const connectionId = event.requestContext?.connectionId
  const body = event.body

  if (!body) {
    return { statusCode: 400, body: 'Missing message body' }
  }

  try {
    const message = JSON.parse(body)

    switch (message.type) {
      case 'ready':
        // Client is registering with a subdomain
        return await handleReady(dynamodb, connectionId, message, event, TABLE_NAME)

      case 'response':
        // Client is sending a response to a forwarded request
        return await handleResponse(dynamodb, message, RESPONSE_TABLE_NAME)

      case 'ping':
        // Client ping - send pong back
        return await handlePing(dynamodb, connectionId, event, TABLE_NAME)

      default:
        console.warn(`Unknown message type: ${message.type}`)
        return { statusCode: 400, body: `Unknown message type: ${message.type}` }
    }
  }
  catch (error) {
    console.error('Message handling error:', error)
    return { statusCode: 500, body: 'Failed to process message' }
  }
}

/**
 * Handle client registration with subdomain
 */
async function handleReady(
  dynamodb: any,
  connectionId: string,
  message: { subdomain?: string },
  event: any,
  tableName: string,
): Promise<{ statusCode: number, body: string }> {
  const subdomain = message.subdomain

  if (!subdomain) {
    return { statusCode: 400, body: 'Subdomain is required' }
  }

  // Validate subdomain format
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
    return { statusCode: 400, body: 'Invalid subdomain format' }
  }

  try {
    // Update the connection with the subdomain
    await dynamodb.updateItem({
      TableName: tableName,
      Key: {
        connectionId: { S: connectionId },
      },
      UpdateExpression: 'SET subdomain = :subdomain, readyAt = :readyAt',
      ExpressionAttributeValues: {
        ':subdomain': { S: subdomain },
        ':readyAt': { N: Date.now().toString() },
      },
    })

    // Send confirmation back to client via API Gateway Management API
    // Note: This uses the raw AWS API since ts-cloud doesn't have an API Gateway Management client yet
    const { AWSClient } = await import('@stacksjs/ts-cloud')
    const aws = new AWSClient({ region: process.env.AWS_REGION || 'us-east-1' })

    const endpoint = `https://${event.requestContext.domainName}/${event.requestContext.stage}`

    await aws.request({
      service: 'execute-api',
      region: process.env.AWS_REGION || 'us-east-1',
      method: 'POST',
      path: `/@connections/${connectionId}`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'registered',
        subdomain,
        url: `https://${subdomain}.localtunnel.dev`,
      }),
    })

    return { statusCode: 200, body: 'Registered' }
  }
  catch (error) {
    console.error('Registration error:', error)
    return { statusCode: 500, body: 'Failed to register' }
  }
}

/**
 * Handle response from tunnel client
 */
async function handleResponse(
  dynamodb: any,
  message: {
    id: string
    status: number
    headers?: Record<string, string>
    body?: string
    isBase64Encoded?: boolean
  },
  tableName: string,
): Promise<{ statusCode: number, body: string }> {
  const { id: requestId, status, headers = {}, body = '', isBase64Encoded = false } = message

  if (!requestId) {
    return { statusCode: 400, body: 'Request ID is required' }
  }

  try {
    // Store response in DynamoDB for the HTTP handler to pick up
    await dynamodb.putItem({
      TableName: tableName,
      Item: {
        requestId: { S: requestId },
        status: { N: status.toString() },
        headers: { S: JSON.stringify(headers) },
        body: { S: body },
        isBase64Encoded: { BOOL: isBase64Encoded },
        createdAt: { N: Date.now().toString() },
        ttl: { N: Math.floor(Date.now() / 1000 + 60).toString() }, // 60 second TTL
      },
    })

    return { statusCode: 200, body: JSON.stringify({ type: 'response_stored', id: requestId }) }
  }
  catch (error) {
    console.error('Response storage error:', error)
    return { statusCode: 500, body: 'Failed to store response' }
  }
}

/**
 * Handle ping from client
 */
async function handlePing(
  dynamodb: any,
  connectionId: string,
  event: any,
  tableName: string,
): Promise<{ statusCode: number, body: string }> {
  try {
    // Send pong back via API Gateway Management API
    const { AWSClient } = await import('@stacksjs/ts-cloud')
    const aws = new AWSClient({ region: process.env.AWS_REGION || 'us-east-1' })

    await aws.request({
      service: 'execute-api',
      region: process.env.AWS_REGION || 'us-east-1',
      method: 'POST',
      path: `/@connections/${connectionId}`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'pong' }),
    })

    // Update last seen timestamp
    await dynamodb.updateItem({
      TableName: tableName,
      Key: {
        connectionId: { S: connectionId },
      },
      UpdateExpression: 'SET lastSeen = :lastSeen',
      ExpressionAttributeValues: {
        ':lastSeen': { N: Date.now().toString() },
      },
    })

    return { statusCode: 200, body: 'Pong' }
  }
  catch (error) {
    console.error('Ping error:', error)
    return { statusCode: 500, body: 'Failed to respond to ping' }
  }
}
