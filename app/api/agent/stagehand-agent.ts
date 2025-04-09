import { StagehandBrowser } from "./stagehand-browser";

export class StagehandAgent {
  private stagehandBrowser: StagehandBrowser;
  private model: string;
  private printSteps: boolean;
  public lastResponseId: string | undefined = undefined;
  private conversationHistory: { role: string; content: string }[] = [];

  constructor(
    model: string = "claude-3-7-sonnet-20250219",
    stagehandBrowser: StagehandBrowser,
    printSteps: boolean = false,
  ) {
    this.model = model;
    this.stagehandBrowser = stagehandBrowser;
    this.printSteps = printSteps;
  }

  async getAction(
    inputItems: any[],
    previousResponseId: string | undefined
  ): Promise<{ output: any[]; responseId: string }> {
    try {
      // Initialize StagehandBrowser if not already done
      await this.stagehandBrowser.init();
      
      // Get the current agent
      const agent = this.stagehandBrowser.getAgent({
        model: this.model,
        provider: "anthropic",
        instructions: "Use the web browser to complete the task. Navigate websites and extract information as needed."
      });
      
      // Process input items to update conversation history
      for (const item of inputItems) {
        if (item.role === "user" && typeof item.content === "string") {
          this.conversationHistory.push({ 
            role: "user", 
            content: item.content 
          });
        } else if (item.role === "assistant" && typeof item.content === "string") {
          this.conversationHistory.push({ 
            role: "assistant", 
            content: item.content 
          });
        } else if (item.type === "message" && item.content && Array.isArray(item.content)) {
          const textContent = item.content.find((c: any) => c.type === "text");
          if (textContent && textContent.text) {
            this.conversationHistory.push({ 
              role: item.role || (item.type === "message" ? "assistant" : "user"), 
              content: textContent.text 
            });
          }
        } else if (item.type === "computer_call_output" || item.type === "function_call_output") {
          // Handle outputs from tools by adding them to conversation history as system messages
          console.log(`Processing tool output of type: ${item.type}`);
          if (item.output && item.output.image_url) {
            // We had a screenshot taken, note it in the conversation for context
            this.conversationHistory.push({
              role: "system",
              content: "I took a screenshot of the current page state."
            });
          } else if (item.output) {
            this.conversationHistory.push({
              role: "system",
              content: `Tool execution result: ${JSON.stringify(item.output)}`
            });
          }
        }
      }
      
      // Log the current conversation history for debugging
      if (this.printSteps) {
        console.log("Current conversation history:", JSON.stringify(this.conversationHistory, null, 2));
      }
      
      // Extract the user's current request
      let currentRequest = "Explore the current page";
      const lastUserInput = inputItems
        .filter(item => item.role === "user" || (item.type === "message" && item.role === "user"))
        .pop();
      
      if (lastUserInput) {
        if (lastUserInput.role === "user" && typeof lastUserInput.content === "string") {
          currentRequest = lastUserInput.content;
        } else if (lastUserInput.content && Array.isArray(lastUserInput.content)) {
          const textContent = lastUserInput.content.find((c: any) => c.type === "text");
          if (textContent && textContent.text) {
            currentRequest = textContent.text;
          }
        } else if (typeof lastUserInput.content === "string") {
          currentRequest = lastUserInput.content;
        }
      }
      
      console.log(`Sending request to Anthropic with conversation history (${this.conversationHistory.length} messages) and current request: ${currentRequest.substring(0, 50)}...`);
      
      // Make the execution parameters mimic the OpenAI agent format that operator.ts uses
      let executeParams: any = {
        instruction: currentRequest,
      };
      
      // Only pass the history if we have previous messages
      if (this.conversationHistory.length > 0) {
        executeParams.history = this.conversationHistory;
        executeParams.saveToHistory = true;
      }
      
      // If we have a previous response ID, include it in agent parameters
      if (previousResponseId) {
        console.log(`Including previous response ID: ${previousResponseId}`);
        executeParams.previousResponseId = previousResponseId;
      }
      
      // Execute the agent with history context
      const result = await agent.execute(executeParams);
      
      // Update history with the response
      this.conversationHistory.push({
        role: "assistant",
        content: result.message
      });
      
      // Format the response similar to the old agent format
      this.lastResponseId = new Date().toISOString();
      
      const output = [
        {
          type: "message",
          content: [{ type: "text", text: result.message }]
        }
      ];
      
      return {
        output,
        responseId: this.lastResponseId
      };
    } catch (error) {
      console.error("Error in Stagehand agent execution:", error);
      
      const errorMessage = error instanceof Error ? error.message : "Unknown error in Stagehand agent";
      
      return {
        output: [
          {
            type: "message",
            content: [{ type: "text", text: `Error: ${errorMessage}` }]
          }
        ],
        responseId: new Date().toISOString()
      };
    }
  }

  async takeMessageAction(messageItem: any): Promise<any> {
    if (this.printSteps && messageItem.content?.[0]) {
      console.log(messageItem.content[0]);
    }
    return messageItem;
  }

  async takeFunctionAction(functionItem: any): Promise<any> {
    const name = functionItem.name;
    const args = JSON.parse(functionItem.arguments);
    
    if (this.printSteps) {
      console.log(`${name}(${JSON.stringify(args)})`);
    }

    if (name === "goto" && args.url) {
      await this.stagehandBrowser.goto(args.url);
    } else if (name === "back") {
      await this.stagehandBrowser.back();
    }

    return {
      type: "function_call_output",
      call_id: functionItem.call_id,
      output: "success",
    };
  }
} 