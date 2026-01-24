/**
 * Lambda handler for WebSocket $connect route
 * This is deployed to AWS Lambda and uses the AWS SDK v3
 */

// Note: When deployed to Lambda, @aws-sdk is available in the runtime
// For local development/testing, it needs to be installed

export async function handler(event: any): Promise<any> {
  // Dynamic import to handle both Lambda runtime and local environments
  const { DynamoDBClient, PutItemCommand, QueryCommand } = await import('@aws-sdk/client-dynamodb')

  const dynamodb = new DynamoDBClient({})
  const TABLE_NAME = process.env.TABLE_NAME!

  const connectionId = event.requestContext?.connectionId
  const subdomain = event.queryStringParameters?.subdomain
  const sourceIp = event.requestContext?.identity?.sourceIp
  const userAgent = event.headers?.['user-agent']

  // Subdomain is optional at connect time - client can send 'ready' message later
  // But if provided, validate it
  if (subdomain) {
    // Validate subdomain format
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      console.error(`Invalid subdomain format: ${subdomain}`)
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid subdomain format',
          message: 'Subdomain must be lowercase alphanumeric with optional hyphens, 3-63 characters',
        }),
      }
    }

    // Check if subdomain is already in use
    try {
      const existing = await dynamodb.send(new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'subdomain-index',
        KeyConditionExpression: 'subdomain = :subdomain',
        ExpressionAttributeValues: {
          ':subdomain': { S: subdomain },
        },
      }))

      if (existing.Items && existing.Items.length > 0) {
        console.warn(`Subdomain already in use: ${subdomain}`)
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: 'Subdomain in use',
            message: `The subdomain "${subdomain}" is already claimed by another tunnel`,
          }),
        }
      }
    }
    catch (error) {
      console.error('Error checking subdomain availability:', error)
    }
  }

  try {
    // Store connection in DynamoDB
    const item: Record<string, any> = {
      connectionId: { S: connectionId },
      connectedAt: { N: Date.now().toString() },
      lastSeen: { N: Date.now().toString() },
      status: { S: 'connected' },
    }

    // Add optional fields
    if (subdomain) {
      item.subdomain = { S: subdomain }
    }
    if (sourceIp) {
      item.sourceIp = { S: sourceIp }
    }
    if (userAgent) {
      item.userAgent = { S: userAgent }
    }

    // Add TTL for connection cleanup (24 hours)
    item.ttl = { N: Math.floor(Date.now() / 1000 + 86400).toString() }

    await dynamodb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: item,
    }))

    console.log(`Connection established: ${connectionId}${subdomain ? ` for subdomain: ${subdomain}` : ''}`)

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Connected',
        connectionId,
        subdomain: subdomain || null,
      }),
    }
  }
  catch (error) {
    console.error('Connection error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Connection failed',
        message: 'Failed to establish tunnel connection',
      }),
    }
  }
}
