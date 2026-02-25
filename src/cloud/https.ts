/**
 * Lambda handler for HTTP requests
 * Uses ts-cloud DynamoDBClient and AWSClient instead of @aws-sdk
 *
 * Note: These Lambda handlers are part of the legacy Lambda+DynamoDB architecture.
 * The primary deployment now uses EC2 with TunnelServer directly.
 */

import { randomBytes } from 'node:crypto'

// Response polling configuration
const POLL_INTERVAL_MS = 50
const MAX_WAIT_MS = 30000 // 30 second timeout

interface TunnelResponse {
  status: number
  headers: Record<string, string>
  body: string
  isBase64Encoded?: boolean
}

export async function handler(event: any): Promise<any> {
  const { AWSClient, DynamoDBClient } = await import('@stacksjs/ts-cloud')

  const region = process.env.AWS_REGION || 'us-east-1'
  const dynamodb = new DynamoDBClient(region)
  const aws = new AWSClient({ region })
  const TABLE_NAME = process.env.TABLE_NAME!
  const RESPONSE_TABLE_NAME = process.env.RESPONSE_TABLE_NAME!
  const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT!

  const host = event.headers?.host || ''
  const subdomain = host.split('.')[0]
  const path = event.rawPath || '/'

  // Handle health check endpoints
  if (path === '/health' || path === '/_health') {
    return {
      statusCode: 200,
      body: 'OK',
    }
  }

  // Handle status endpoint
  if (path === '/status' || path === '/_status') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'ok',
        version: '0.2.0',
        timestamp: new Date().toISOString(),
      }),
    }
  }

  if (!subdomain || subdomain === host) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid subdomain' }),
    }
  }

  try {
    // Find connection for the subdomain
    const connections = await dynamodb.query({
      TableName: TABLE_NAME,
      IndexName: 'subdomain-index',
      KeyConditionExpression: 'subdomain = :subdomain',
      ExpressionAttributeValues: {
        ':subdomain': { S: subdomain },
      },
    })

    if (!connections.Items || connections.Items.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Tunnel not found',
          subdomain,
          message: `No tunnel client is connected for subdomain: ${subdomain}`,
        }),
      }
    }

    const connection = connections.Items[0]
    const connectionId = connection.connectionId.S!

    // Generate unique request ID
    const requestId = `req_${randomBytes(16).toString('hex')}`

    // Prepare the request to forward
    const message = {
      type: 'request',
      id: requestId,
      method: event.requestContext?.http?.method || 'GET',
      path: event.rawPath + (event.rawQueryString ? `?${event.rawQueryString}` : ''),
      url: `https://${host}${event.rawPath}${event.rawQueryString ? `?${event.rawQueryString}` : ''}`,
      headers: event.headers,
      body: event.body,
      isBase64Encoded: event.isBase64Encoded,
    }

    try {
      // Send request to WebSocket client via API Gateway Management API
      const endpoint = new URL(WEBSOCKET_ENDPOINT)
      await aws.request({
        service: 'execute-api',
        region,
        method: 'POST',
        path: `/@connections/${connectionId}`,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      })

      // Wait for response from the tunnel client
      const response = await waitForResponse(dynamodb, RESPONSE_TABLE_NAME, requestId)

      if (response) {
        return {
          statusCode: response.status,
          headers: response.headers,
          body: response.body,
          isBase64Encoded: response.isBase64Encoded || false,
        }
      }
      else {
        return {
          statusCode: 504,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Gateway Timeout',
            message: 'Tunnel client did not respond in time',
          }),
        }
      }
    }
    catch (error: any) {
      // Check if the connection is stale
      if (error.name === 'GoneException') {
        // Remove stale connection
        await dynamodb.deleteItem({
          TableName: TABLE_NAME,
          Key: {
            connectionId: { S: connectionId },
          },
        })

        return {
          statusCode: 502,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'Bad Gateway',
            message: 'Tunnel client disconnected',
          }),
        }
      }

      console.error('WebSocket error:', error)
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Bad Gateway',
          message: 'Failed to forward request to tunnel client',
        }),
      }
    }
  }
  catch (error) {
    console.error('Request handling error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      }),
    }
  }
}

/**
 * Wait for a response from the tunnel client by polling DynamoDB
 */
async function waitForResponse(
  dynamodb: any,
  tableName: string,
  requestId: string,
): Promise<TunnelResponse | null> {
  const startTime = Date.now()

  while (Date.now() - startTime < MAX_WAIT_MS) {
    try {
      const result = await dynamodb.getItem({
        TableName: tableName,
        Key: {
          requestId: { S: requestId },
        },
      })

      if (result.Item) {
        // Delete the response record after reading
        await dynamodb.deleteItem({
          TableName: tableName,
          Key: {
            requestId: { S: requestId },
          },
        })

        return {
          status: Number.parseInt(result.Item.status?.N || '200', 10),
          headers: JSON.parse(result.Item.headers?.S || '{}'),
          body: result.Item.body?.S || '',
          isBase64Encoded: result.Item.isBase64Encoded?.BOOL || false,
        }
      }
    }
    catch (error) {
      console.error('Error polling for response:', error)
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  return null
}
