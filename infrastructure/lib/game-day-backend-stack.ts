import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { join } from 'path';

export class GameDayBackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 🎯 SINGLE DYNAMODB TABLE - Maximizes Free Tier!
    const gameDayTable = new dynamodb.Table(this, 'GameDayTable', {
      tableName: 'game-day-data',
      
      // Single table design for free tier optimization
      partitionKey: { 
        name: 'pk', 
        type: dynamodb.AttributeType.STRING 
      },
      sortKey: { 
        name: 'sk', 
        type: dynamodb.AttributeType.STRING 
      },
      
      // Pay per request = free tier friendly
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      
      // Disable point-in-time recovery (costs extra - not needed for free tier)
      pointInTimeRecovery: false,
      
      // Cleanup policy
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Don't accidentally delete data
    });

    // GSI for querying user's data - inherit billing mode from table (PAY_PER_REQUEST)
    gameDayTable.addGlobalSecondaryIndex({
      indexName: 'user-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      // No need to specify billing mode - inherits from table (PAY_PER_REQUEST = free tier friendly)
    });

    // 🚀 LAMBDA FUNCTION - Single function handles everything (PYTHON)
    const gameDayApi = new lambda.Function(this, 'GameDayApi', {
      functionName: 'game-day-api',
      runtime: lambda.Runtime.PYTHON_3_11,
      code: lambda.Code.fromAsset(join(__dirname, '../lambda')),
      handler: 'lambda_function.lambda_handler',
      
      // Optimize for free tier
      memorySize: 128, // Minimum = maximize free tier seconds
      timeout: cdk.Duration.seconds(30), // Reasonable timeout
      
      // Environment variables
      environment: {
        TABLE_NAME: gameDayTable.tableName,
        USER_INDEX_NAME: 'user-index',
      },
    });

    // Add Function URL separately (FREE alternative to API Gateway!)
    const functionUrl = gameDayApi.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'], // Allow all origins for development
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
        allowCredentials: false,
        maxAge: cdk.Duration.hours(1),
      },
    });

    // 🔐 GRANT DYNAMODB PERMISSIONS TO LAMBDA
    gameDayTable.grantReadWriteData(gameDayApi);

    // 📊 OUTPUTS - Important URLs and info
    new cdk.CfnOutput(this, 'TableName', {
      value: gameDayTable.tableName,
      description: 'DynamoDB table name',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionUrl', {
      value: functionUrl.url,
      description: 'Lambda Function URL - use this as your API endpoint',
    });

    new cdk.CfnOutput(this, 'LambdaFunctionName', {
      value: gameDayApi.functionName,
      description: 'Lambda function name',
    });

    // 💰 COST OPTIMIZATION REMINDERS
    new cdk.CfnOutput(this, 'EstimatedMonthlyCost', {
      value: '$0 (within free tier limits)',
      description: 'DynamoDB: 25GB + 25 WCU/RCU, Lambda Python: 1M requests + 400K GB-seconds',
    });
  }
}