#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GameDayBackendStack } from '../lib/game-day-backend-stack';

const app = new cdk.App();

// Create the backend stack
new GameDayBackendStack(app, 'GameDayBackendStack', {
  // Optimize for free tier
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  
  // Add tags for cost tracking
  tags: {
    Project: 'GameDaySite',
    Environment: 'production',
    CostCenter: 'free-tier'
  }
});