import { WebClient } from "@slack/web-api";
import { openai } from "@ai-sdk/openai";
import { CoreMessage, generateObject } from "ai";
import { z } from "zod";
import { put, list } from "@vercel/blob";
import { StagehandBrowser } from "../agent/stagehand-browser";
import { StagehandAgent } from "../agent/stagehand-agent";
import { ComputerCallOutput } from "../agent/types";

// Define state type
export interface AgentState {
  goal: string;
  currentStep: {
    output: any[];
    responseId: string;
  };
}

// Helper functions for state management
export async function saveState(sessionId: string, state: AgentState) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn("BLOB_READ_WRITE_TOKEN is not set. State will not be saved.");
    return "";
  }

  try {
    const { url } = await put(
      `agent-${sessionId}-state.json`,
      JSON.stringify(state),
      { access: "public", addRandomSuffix: true }
    );
    return url;
  } catch (error) {
    console.error("Error saving state:", error);
    return "";
  }
}

export async function getState(sessionId: string): Promise<AgentState | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn("BLOB_READ_WRITE_TOKEN is not set. State cannot be retrieved.");
    return null;
  }

  try {
    const { blobs } = await list({ prefix: `agent-${sessionId}-state` });
    if (blobs.length === 0) return null;

    // get the most recently created blob
    const mostRecentBlob = blobs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];

    const response = await fetch(mostRecentBlob.url);
    const text = await response.text();
    return JSON.parse(text) as AgentState;
  } catch (error) {
    console.error("[getState] Error retrieving state:", error);
    return null;
  }
}

async function selectStartingUrl(goal: string) {
    const message: CoreMessage = {
      role: "user",
      content: [
        {
          type: "text",
          text: `Given the goal: "${goal}", determine the best URL to start from.
  Choose from:
  1. A relevant search engine (Google, Bing, etc.)
  2. A direct URL if you're confident about the target website
  3. Any other appropriate starting point
  
  Return a URL that would be most effective for achieving this goal.`,
        },
      ],
    };
  
    // Initialize OpenAI client
    const LLMClient = openai("gpt-4o");
  
    const result = await generateObject({
      model: LLMClient,
      schema: z.object({
        url: z.string().url(),
        reasoning: z.string(),
      }),
      abortSignal: AbortSignal.timeout(5000),
      messages: [message],
    }).catch((error) => {
      console.error("OpenAI timeout when generating starting URL, falling back to Google");
      return {
        object: {
          url: "https://www.google.com",
        },
      };
    });
  
    return result.object;
}

async function execute(computer: StagehandBrowser, output: any) {
  console.log("Executing action with Stagehand browser...");
  
  try {
    await computer.init();

    const actionType = output.output.find((item: any) => item.type === "computer_call")?.action?.type;
    if (actionType) {
      console.log(`Executing ${actionType} action...`);
    }
    
    return output.output;
  } catch (error) {
    console.error("Error executing action:", error);
    throw error;
  }
}

async function generate(agent: StagehandAgent, input: any, responseId: string) {
  console.log(`Generating next action with ${input.length} input items...`);
  
  try {
    console.log("Calling agent.getAction...");
    
    // Pass along the previous response ID to maintain continuity
    let result = await agent.getAction(input, responseId);
    console.log("Agent action generated successfully");

    return result;
  } catch (error) {
    console.error("Error generating action:", error);
    throw error;
  }
}

export async function runStagehandAgentLoop(
  computer: StagehandBrowser,
  agent: StagehandAgent,
  goal: string,
  sessionId: string,
  slack?: WebClient,
  channel?: string,
  threadTs?: string,
  savedState?: AgentState,
  userResponse?: string
) {
  // Initialize state from saved state if it exists
  let currentStep: {
    output: any[];
    responseId: string;
  } | null = null;

  if (savedState) {
    try {
      currentStep = savedState.currentStep;
    } catch (error) {
      console.error("[runStagehandAgentLoop] Error parsing saved state:", error);
    }
  }

  // If we have no saved state, start from scratch
  if (!savedState) {
    if (slack && channel && threadTs) {
      await slack.chat.postMessage({
        channel: channel,
        text: `🤖 Stagehand Operator: Starting up to complete the task!\n\nYou can follow along at https://www.browserbase.com/sessions/${sessionId}`,
        thread_ts: threadTs,
      });
    } else {
      console.log(
        `🤖 Stagehand Operator: Starting up to complete the task! You can follow along at https://www.browserbase.com/sessions/${sessionId}`
      );
    }
    
    // Initialize the browser
    await computer.init();

    // Choose a starting URL
    const startingUrl = await selectStartingUrl(goal);
    
    // Navigate to the starting URL
    await computer.goto(startingUrl.url);
    
    // Initialize the agent with the first step
    currentStep = await agent.getAction([
      {
        role: "user",
        content: goal,
      },
    ], undefined);
  }

  // If there's a user response and we have a current step, incorporate the response
  if (userResponse && currentStep) {
    // Find the message in the current output
    const lastMessage = currentStep.output.find((item) => item.type === "message");
    const messageText = lastMessage?.content?.[0]?.text || "";
    
    // Generate the next step with the user's response
    currentStep = await generate(
      agent,
      [
        {
          role: "assistant",
          content: messageText,
        },
        {
          role: "user",
          content: userResponse,
        },
      ],
      currentStep.responseId
    );
    
    const message = currentStep.output.find((item) => item.type === "message");
    if (message && message.content && message.content[0] && message.content[0].text) {
      if (slack && channel && threadTs) {
        // In Slack mode, send the follow-up response directly
        // Save state first
        try {
          if (process.env.BLOB_READ_WRITE_TOKEN) {
            await saveState(sessionId, {
              goal,
              currentStep: currentStep,
            });
          }
        } catch (error) {
          console.warn("Could not save state, but continuing:", error);
        }
        
        // Send screenshot with the response
        const screenshot = await computer.screenshot();
        await slack.files.uploadV2({
          channel_id: channel,
          thread_ts: threadTs,
          file: Buffer.from(screenshot.replace(
              /^data:image\/\w+;base64,/,
              ""
            ),
            "base64"
          ),
          filename: "screenshot.png",
        });
        
        // Send the follow-up response
        await slack.chat.postMessage({
          channel: channel,
          text: `🤖 Stagehand Operator: ${message.content[0].text}\n\nYou can control the browser if needed at https://www.browserbase.com/sessions/${sessionId}`,
          thread_ts: threadTs,
        });
        
        return message.content[0].text;
      } else {
        // For non-Slack mode, we just return the follow-up message
        console.log(`💬 Follow-up response: ${message.content[0].text}`);
        return message.content[0].text;
      }
    }
  }

  // Execute the agent loop
  while (currentStep) {
    // Execute the current step
    const nextOutput = await execute(computer, currentStep);

    // Handle screenshots for Slack
    const screenshotOutput = nextOutput.find((item: ComputerCallOutput) => item.type === "computer_call_output");
    if (screenshotOutput && slack && channel && threadTs) {
      // Extract the base64 image
      const base64Image = screenshotOutput.output.image_url.replace(
        /^data:image\/\w+;base64,/,
        ""
      );
      
      // Upload the screenshot to Slack
      await slack.files.uploadV2({
        channel_id: channel,
        thread_ts: threadTs,
        file: Buffer.from(base64Image, "base64"),
        filename: "screenshot.png",
        title: "Current Browser View",
      });
    }

    // Get next step
    const nextStep = await generate(agent, nextOutput, currentStep.responseId);
    
    currentStep = nextStep;

    // Find any messages in the output
    const message = nextStep.output.find((item) => item.type === "message");
    if (message && message.content && message.content[0] && message.content[0].text) {
      // Send the message to Slack or log it
      if (slack && channel && threadTs) {
        // Save state before sending message
        try {
          if (process.env.BLOB_READ_WRITE_TOKEN) {
            await saveState(sessionId, {
              goal,
              currentStep: nextStep,
            });
          }
        } catch (error) {
          console.warn("Could not save state, but continuing:", error);
        }
        
        // Take a screenshot to show current page state
        const screenshot = await computer.screenshot();
        await slack.files.uploadV2({
          channel_id: channel,
          thread_ts: threadTs,
          file: Buffer.from(screenshot.replace(
              /^data:image\/\w+;base64,/,
              ""
            ),
            "base64"
          ),
          filename: "screenshot.png",
        });
        
        // Send the message
        await slack.chat.postMessage({
          channel: channel,
          text: `🤖 Stagehand Operator: ${message.content[0].text}\n\nYou can control the browser if needed at https://www.browserbase.com/sessions/${sessionId}`,
          thread_ts: threadTs,
        });
      } else {
        console.log(`💬 Message: ${message.content[0].text}`);
        return currentStep; // Return the current step for non-Slack mode
      }
      
      // End the loop by setting currentStep to null
      currentStep = null;
    }
  }

  return "Task completed.";
} 