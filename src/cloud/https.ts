import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import process from 'node:process'
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb'

const dynamoDB = new DynamoDBClient({})
const TABLE_NAME = process.env.TABLE_NAME!

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const host = event.headers.host || ''
  const subdomain = host.split('.')[0]

  if (!subdomain) {
    return {
      statusCode: 400,
      body: 'Invalid subdomain',
    }
  }

  try {
    // Find connection for the subdomain
    const connections = await dynamoDB.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'subdomain-index',
      KeyConditionExpression: 'subdomain = :subdomain',
      ExpressionAttributeValues: {
        ':subdomain': { S: subdomain },
      },
    }))

    if (!connections.Items || connections.Items.length === 0) {
      return {
        statusCode: 404,
        body: 'Tunnel not found',
      }
    }

    const connection = connections.Items[0]
    const connectionId = connection.connectionId.S!

    // Create API Gateway Management API client
    const endpoint = new URL(process.env.WEBSOCKET_ENDPOINT!)
    const apiGateway = new ApiGatewayManagementApiClient({
      endpoint: `https://${endpoint.host}`,
    })

    // Forward request to WebSocket client
    const message = {
      action: 'request',
      connectionId,
      data: {
        method: event.requestContext.http.method,
        path: event.rawPath,
        headers: event.headers,
        queryStringParameters: event.queryStringParameters,
        body: event.body,
      },
    }

    try {
      await apiGateway.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(message)),
      }))

      // Wait for response (in a real implementation, you'd use a response queue or callback)
      await new Promise(resolve => setTimeout(resolve, 1000))

      return {
        statusCode: 200,
        body: 'Request forwarded',
      }
    }
    catch (error) {
      console.error('WebSocket error:', error)
      return {
        statusCode: 502,
        body: 'Failed to forward request',
      }
    }
  }
  catch (error) {
    console.error('Request handling error:', error)
    return {
      statusCode: 500,
      body: 'Internal server error',
    }
  }
}
