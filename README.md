# Slack Operator with Stagehand Agent

A simple AI browser automation agent connected to Slack and powered by [Browserbase](https://browserbase.com/) and [Stagehand](https://www.stagehand.dev/).

## Overview
- [How it Works](#how-it-works)
- [Running locally (without Slack)](#running-locally-without-slack)
- [Deploying to Production](#deploying-to-production)

## How it Works

Slack Operator is an AI-powered browser automation agent that can perform web-based tasks through natural language commands in Slack. Here's how the system works:

1. **Browser Control**: The agent uses [Stagehand](https://www.stagehand.dev/) on [Browserbase](https://browserbase.com) to control a real browser instance, allowing it to interact with websites just like a human would. 

2. **Integration Points**:
   - **Slack Integration**: When deployed, the bot listens for mentions in Slack channels and responds to user requests in threads
   - **Demo API**: A simplified endpoint (`/api/demo`) for testing the functionality without Slack integration

3. **Agent Loop**:
   - The agent receives a goal (either from Slack or the demo API)
   - It analyzes the request and determines the appropriate starting point (usually a relevant website)
   - Through an iterative process powered by Stagehand, it:
     - Navigates websites
     - Interacts with web elements using semantic commands (e.g., "Click the sign in button")
     - Extracts information from the page
     - Reports progress back to the user
   - When deployed to Vercel, the agent maintains state between interactions, allowing for follow-up questions and multi-step tasks

4. **State Management**:
   - For Slack interactions, the agent maintains conversation state using Vercel's blob storage to support continuous interactions
   - Each session uses a dedicated browser instance that persists throughout the task

5. **Regional Optimization**:
   - The system automatically selects the closest browser region based on the server's timezone for optimal performance

## Running locally (without Slack)

You can test the functionality directly using the demo API endpoint without setting up Slack integration:

1. Clone this repository

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env.local` and add your API keys. You can get a Browserbase API key and project ID from the [Browserbase Dashboard](https://www.browserbase.com/overview).
   ```
   BROWSERBASE_API_KEY=your-browserbase-api-key
   BROWSERBASE_PROJECT_ID=your-browserbase-project-id
   ANTHROPIC_API_KEY=your-anthropic-api-key
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Send a POST request to `/api/demo` with your goal:
   ```bash
   curl -X POST http://localhost:3000/api/demo \
     -H "Content-Type: application/json" \
     -d '{"goal": "What is the weather in San Francisco?"}'
   ```

Note: The demo endpoint does not support follow up questions with the agent. The requires persistent state to be saved between steps.


## Deploying to Production

### 1. Deploy to Vercel
1. [Click here](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fbrowserbase%2Fslack-operator&env=BROWSERBASE_API_KEY,BROWSERBASE_PROJECT_ID,ANTHROPIC_API_KEY&envDescription=You'll%20need%20these%20variables%20to%20deploy%20this.%20To%20integrate%20Slack%2C%20you'll%20also%20need%20SLACK_BOT_TOKEN%2C%20SLACK_SIGNING_SECRET%2C%20and%20SLACK_BOT_USER_ID.%20&envLink=https%3A%2F%2Fgithub.com%2Fbrowserbase%2Fslack-operator%23deploying-to-production) to create a pre-configured Vercel project
2. Once it's deployed, you'll need to enable [blob storage](https://vercel.com/docs/vercel-blob) and [fluid compute](https://vercel.com/docs/functions/fluid-compute) to enable state persistence and long-running tasks. Make sure to update slack/route.ts 
3. You can test it's working by sending a POST request to `/api/demo` with your goal.
   ```bash
   curl -X POST https://YOUR_VERCEL_URL/api/demo \
     -H "Content-Type: application/json" \
     -d '{"goal": "What is the weather in San Francisco?"}'
   ```
4. Once Slack integration is set up, you'll need to configure the environment variables in Vercel as described in the next steps.

### 2. Create Slack App
1. Go to https://api.slack.com/apps and click "Create New App"
2. Choose "From an app manifest"
3. Select your workspace and paste the contents of `slack-manifest.json`
4. Replace `https://your-vercel-deployment-url` in the manifest with your actual Vercel deployment URL
5. Review and create the app

### 3. Install Slack App to Workspace
1. Go to "Install App" in the sidebar
2. Click "Install to Workspace" and authorize the app

### 4. Configure Environment Variables
1. Go to your Slack App's "Basic Information" page and copy the "Signing Secret"
2. Go to "OAuth & Permissions" and copy the "Bot User OAuth Token"
3. In your Vercel project settings, add these environment variables:
   - `SLACK_BOT_TOKEN`: Your Bot User OAuth Token (starts with xoxb-)
      - Go to "OAuth & Permissions" and copy the "Bot User OAuth Token"
   - `SLACK_SIGNING_SECRET`: Your Signing Secret
      - Go to your Slack App's "Basic Information" page
   - `SLACK_BOT_USER_ID`: Your Bot User ID (starts with U)
      - You can get that from the Slack API. You'll need the user_id from the response
      ```
      curl -X POST "https://slack.com/api/auth.test" -H "Authorization: Bearer xoxb-your-slack-bot-token" 
      ```
   - `BROWSERBASE_API_KEY`: Your Browserbase API Key
   - `BROWSERBASE_PROJECT_ID`: Your Browserbase Project ID
   - `ANTHROPIC_API_KEY`: Your Anthropic API Key
4. Make sure to enable Fluid Compute and update the timeout in `slack/route.ts` to 800 seconds! Otherwise the agent will timeout while working.
5. Redeploy your Vercel project for the changes to take effect
