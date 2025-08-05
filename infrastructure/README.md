# 🚀 Game Day Site - AWS Backend Infrastructure

## What This Does
Creates a **FREE TIER OPTIMIZED** AWS backend for your Game Day site:
- ✅ **DynamoDB Table** - Stores comments & ratings (FREE: 25GB + 25 WCU/RCU)
- ✅ **Lambda Function** - API for CRUD operations (FREE: 1M requests/month)
- ✅ **Function URLs** - Direct HTTPS endpoints (FREE: No API Gateway needed!)

**Monthly Cost: $0** (within free tier limits)

---

## 🎯 SUPER SIMPLE DEPLOYMENT GUIDE

### Prerequisites (One-time setup)
1. **Install AWS CLI**:
   ```bash
   # Download from: https://aws.amazon.com/cli/
   aws --version  # Should show version
   ```

2. **Configure AWS CLI** (you need an AWS account):
   ```bash
   aws configure
   # Enter your:
   # AWS Access Key ID: [get from AWS Console > IAM > Users > Security credentials]
   # AWS Secret Access Key: [from same place]
   # Default region: us-east-1 (cheapest)
   # Default output format: json
   ```

3. **Install CDK CLI**:
   ```bash
   npm install -g aws-cdk
   cdk --version  # Should show version
   ```

### 🚀 Deploy Your Backend

1. **Navigate to infrastructure folder**:
   ```bash
   cd infrastructure
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Bootstrap CDK** (first time only):
   ```bash
   cdk bootstrap
   # This creates CDK resources in your AWS account
   ```

4. **Deploy the stack**:
   ```bash
   cdk deploy
   # Say 'y' when it asks for confirmation
   # Takes 2-3 minutes
   ```

5. **🎉 DONE!** Copy the outputs:
   ```
   ✅ GameDayBackendStack.LambdaFunctionUrl = https://xyz.lambda-url.us-east-1.on.aws/
   ✅ GameDayBackendStack.TableName = game-day-data
   ```

---

## 🔧 Using Your API

Your Lambda Function URL is your API endpoint. Use it like this:

### Comments API
```bash
# Get all comments for a game
GET https://your-lambda-url/comments/gloomhaven

# Add a comment
POST https://your-lambda-url/comments/gloomhaven
{
  "userId": "user123",
  "username": "Alice", 
  "comment": "Great game!",
  "rating": 9
}

# Update a comment
PUT https://your-lambda-url/comments/gloomhaven/user123#1234567890
{
  "comment": "Updated comment",
  "rating": 8
}

# Delete a comment
DELETE https://your-lambda-url/comments/gloomhaven/user123#1234567890
```

### Ratings API
```bash
# Get ratings for a game
GET https://your-lambda-url/ratings/gloomhaven

# Add/update rating
POST https://your-lambda-url/ratings/gloomhaven
{
  "userId": "user123",
  "username": "Alice",
  "rating": 9
}
```

---

## 🔧 Integration with Angular

Add this to your Angular services:

```typescript
// In your games service
const API_BASE_URL = 'https://your-lambda-url-here';

async addComment(gameId: string, comment: any) {
  const response = await fetch(`${API_BASE_URL}/comments/${gameId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(comment)
  });
  return response.json();
}

async getComments(gameId: string) {
  const response = await fetch(`${API_BASE_URL}/comments/${gameId}`);
  return response.json();
}
```

---

## 🛠️ Common Commands

```bash
# Check what will be deployed
cdk diff

# Deploy changes
cdk deploy

# Destroy everything (careful!)
cdk destroy

# View CloudFormation template
cdk synth
```

---

## 🚨 Troubleshooting

### "Access Denied" errors:
- Make sure your AWS credentials are configured: `aws configure list`
- Check your IAM user has permissions for Lambda, DynamoDB, IAM

### "Bootstrap" errors:
- Run: `cdk bootstrap aws://YOUR-ACCOUNT-ID/us-east-1`
- Get your account ID: `aws sts get-caller-identity`

### Lambda function not working:
- Check CloudWatch logs: AWS Console > CloudWatch > Log groups > /aws/lambda/game-day-api
- Test in AWS Console > Lambda > game-day-api > Test

### Free tier exceeded:
- Check AWS Billing dashboard
- DynamoDB: 25 WCU/RCU per month
- Lambda: 1M requests + 400K GB-seconds per month

---

## 📊 Monitoring Costs

1. **AWS Billing Dashboard**: Check monthly usage
2. **DynamoDB Metrics**: AWS Console > DynamoDB > Tables > game-day-data > Monitoring
3. **Lambda Metrics**: AWS Console > Lambda > game-day-api > Monitoring

**Expected usage for small site:**
- DynamoDB: <1GB storage, <100 WCU/RCU per month
- Lambda: <10K requests per month
- **Total cost: $0**

---

## 🎯 Next Steps

1. **Deploy the infrastructure** following the guide above
2. **Copy your Lambda Function URL** from the outputs
3. **Update your Angular app** to use the API endpoint
4. **Test with a few comments** to make sure it works
5. **Deploy your Angular app** to GitHub Pages

You now have a fully serverless, free-tier backend! 🎉