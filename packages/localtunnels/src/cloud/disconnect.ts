/**
 * Lambda handler for WebSocket $disconnect route
 * Uses ts-cloud DynamoDBClient instead of @aws-sdk
 *
 * Note: These Lambda handlers are part of the legacy Lambda+DynamoDB architecture.
 * The primary deployment now uses EC2 with TunnelServer directly.
 */

export async function handler(event: any): Promise<any> {
  const { DynamoDBClient } = await import('@stacksjs/ts-cloud')

  const dynamodb = new DynamoDBClient(process.env.AWS_REGION || 'us-east-1')
  const TABLE_NAME = process.env.TABLE_NAME!

  const connectionId = event.requestContext?.connectionId

  try {
    // First, get the connection to log what subdomain is being released
    const existing = await dynamodb.getItem({
      TableName: TABLE_NAME,
      Key: {
        connectionId: { S: connectionId },
      },
    })

    const subdomain = existing.Item?.subdomain?.S

    // Delete the connection record
    await dynamodb.deleteItem({
      TableName: TABLE_NAME,
      Key: {
        connectionId: { S: connectionId },
      },
    })

    console.log(`Connection closed: ${connectionId}${subdomain ? ` (subdomain: ${subdomain})` : ''}`)

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Disconnected',
        connectionId,
        subdomain: subdomain || null,
      }),
    }
  }
  catch (error) {
    console.error('Disconnection error:', error)

    // Still try to delete even if getting the record failed
    try {
      await dynamodb.deleteItem({
        TableName: TABLE_NAME,
        Key: {
          connectionId: { S: connectionId },
        },
      })
    }
    catch {
      // Ignore secondary errors
    }

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Disconnection error',
        message: 'An error occurred during disconnection, but the connection was likely cleaned up',
      }),
    }
  }
}
