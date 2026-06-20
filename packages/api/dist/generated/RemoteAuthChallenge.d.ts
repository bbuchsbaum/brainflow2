import type { RemoteAuthPrompt } from "./RemoteAuthPrompt";
/**
 * Keyboard-interactive auth challenge details.
 */
export type RemoteAuthChallenge = {
    conversation_id: string;
    name: string;
    instructions: string;
    prompts: Array<RemoteAuthPrompt>;
};
