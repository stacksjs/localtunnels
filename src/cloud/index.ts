import process from 'node:process'
import * as cdk from 'aws-cdk-lib'
import { TunnelStack } from './tunnel-stack'
import 'source-map-support/register'

const app = new cdk.App()

new TunnelStack(app, 'TunnelStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
})
