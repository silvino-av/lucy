import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// Shared state for all agents (Supervisor and Sub-agents)
export const SupervisorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  channel: Annotation<string>({
    reducer: (left?: string, right?: string) => right ?? left ?? "terminal",
    default: () => "terminal",
  })
});
