import { Stagehand } from "@browserbasehq/stagehand";
import { Browserbase } from "@browserbasehq/sdk";
import { chromium } from "playwright";
import axios from "axios";
import { BrowserContext } from "playwright";

// Define BrowserbaseSession type locally since it's not exported
interface BrowserbaseSession {
  id: string;
  connectUrl: string;
  status: string;
}

export class StagehandBrowser {
  private bb: Browserbase;
  private projectId: string;
  private session: BrowserbaseSession | null = null;
  private region: string;
  private proxy: boolean;
  private sessionId: string | null;
  private stagehand: Stagehand | null = null;
  public page: any;
  public context: BrowserContext | null = null;
  public agent: any;
  dimensions: [number, number] = [1024, 768];
  environment: string = "browser";

  constructor(
    width: number = 1024,
    height: number = 768,
    sessionId: string | null = null,
    region: string = "us-west-2",
    proxy: boolean = false
  ) {
    // Validate required environment variables
    if (!process.env.BROWSERBASE_API_KEY) {
      throw new Error("BROWSERBASE_API_KEY environment variable is not set");
    }
    if (!process.env.BROWSERBASE_PROJECT_ID) {
      throw new Error("BROWSERBASE_PROJECT_ID environment variable is not set");
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }
    
    this.bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
    this.projectId = process.env.BROWSERBASE_PROJECT_ID!;
    this.session = null;
    this.dimensions = [width, height];
    this.sessionId = sessionId;
    this.region = region;
    this.proxy = proxy;
  }

  async init() {
    if (this.stagehand) {
      console.log("Stagehand already initialized, returning existing instance");
      return this.stagehand;
    }

    console.log(`Initializing StagehandBrowser (sessionId: ${this.sessionId || 'new session'})`);

    if (this.sessionId) {
      // Connect to existing session
      console.log(`Connecting to existing Browserbase session: ${this.sessionId}`);
      const response = await axios.get(
        `https://api.browserbase.com/v1/sessions/${this.sessionId}`,
        {
          headers: {
            "X-BB-API-Key": process.env.BROWSERBASE_API_KEY,
          },
        }
      );
      this.session = {
        id: this.sessionId,
        connectUrl: response.data.connectUrl,
        status: response.data.status,
      };
    } else {
      // Create a new session on Browserbase with specified parameters
      console.log("Creating new Browserbase session");
      const [width, height] = this.dimensions;
      const sessionParams = {
        projectId: this.projectId,
        browserSettings: {
          blockAds: true,
          viewport: {
            width,
            height,
          },
        },
        region: this.region as
          | "us-west-2"
          | "us-east-1"
          | "eu-central-1"
          | "ap-southeast-1",
        proxies: this.proxy,
        keepAlive: true,
      };

      const createdSession = await this.bb.sessions.create(sessionParams);
      this.session = {
        id: createdSession.id,
        connectUrl: createdSession.connectUrl,
        status: createdSession.status,
      };
      console.log(`Created new Browserbase session: ${this.session.id}`);
    }

    if (!this.session.connectUrl) {
      throw new Error("Browserbase session has terminated.");
    }

    // Connect to the remote session
    console.log(`Connecting to Browserbase via CDP: ${this.session.connectUrl.substring(0, 50)}...`);
    const browser = await chromium.connectOverCDP(this.session.connectUrl, {
      timeout: 1000 * 60,
    });
    const context = browser.contexts()[0];
    const page = context.pages()[0];

    // Initialize Stagehand with the correct parameters
    console.log("Creating Stagehand instance with claude-3-7-sonnet-20250219 model");
    this.stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      browserbaseSessionID: this.session.id,
      modelName: "claude-3-7-sonnet-20250219",
      modelClientOptions: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      verbose: 1,
      enableCaching: true,
      domSettleTimeoutMs: 10000,
      waitForCaptchaSolves: true,
      disablePino: true
    });

    // Initialize stagehand
    console.log("Initializing Stagehand...");
    await this.stagehand.init();
    console.log("Stagehand initialization completed successfully");

    // Only navigate to Google if it's a new session
    if (!this.sessionId) {
      console.log("Navigating to Google...");
      await this.stagehand.page.goto("https://www.google.com");
      console.log("Navigation to Google completed");
    }

    return this.stagehand;
  }

  async screenshot() {
    if (!this.stagehand || !this.stagehand.page) {
      throw new Error("Stagehand not initialized");
    }
    
    const buffer = await this.stagehand.page.screenshot({ type: "png" });
    return buffer.toString("base64");
  }

  async goto(url: string) {
    if (!this.stagehand || !this.stagehand.page) {
      throw new Error("Stagehand not initialized");
    }
    
    await this.stagehand.page.goto(url);
  }

  async back() {
    if (!this.stagehand || !this.stagehand.page) {
      throw new Error("Stagehand not initialized");
    }
    
    await this.stagehand.page.goBack();
  }

  getAgent(options: any = {}) {
    if (!this.stagehand) {
      throw new Error("Stagehand not initialized");
    }
    
    const modelName = options.model || "claude-3-7-sonnet-20250219";
    const provider = options.provider || "anthropic";
    
    console.log(`Initializing Stagehand agent with model: ${modelName} and provider: ${provider}`);
    
    this.agent = this.stagehand.agent({
      provider: provider,
      model: modelName,
      instructions: options.instructions || `You are a helpful assistant that can use a web browser to complete tasks and answer questions.

Follow these guidelines:
1. Be concise and action-oriented in your approach.
2. Execute tasks systematically, showing your work.
3. When searching, use specific search terms.
4. Don't explain what you're about to do, just do it.
5. Don't ask for permission or confirmation before taking actions.
6. Extract requested information clearly and accurately.
7. Take screenshots only when specifically needed.
8. For follow-up questions, continue the conversation naturally using context from previous interactions.
9. Remember details from earlier in the conversation and use them to inform your responses.
10. Answer follow-up questions directly based on what you've already seen or found - don't restart the search unless needed.
11. If the user asks about something you've already found, reference that information directly.
12. Maintain continuity between interactions to create a seamless conversation experience.
13. If asked a follow-up question, use memory of previous actions to provide context-aware responses.
14. Use the web browser to look up any new information needed for follow-up questions.
15. Remember all previously viewed pages and information found when answering follow-up questions.`,
      options: {
        apiKey: process.env.ANTHROPIC_API_KEY,
        supportFollowUpQuestions: true,
      }
    });

    return this.agent;
  }
} 