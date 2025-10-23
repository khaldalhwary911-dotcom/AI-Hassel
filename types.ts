
export enum Feature {
  CHATBOT = 'Chatbot',
  QUICK_QUERY = 'Quick Query',
  COMPLEX_QUERY = 'Complex Query',
  IMAGE_UNDERSTANDING = 'Image Understanding',
  VIDEO_ANALYSIS = 'Video Analysis',
  LIVE_CONVERSATION = 'Live Conversation',
  AUDIO_TRANSCRIPTION = 'Audio Transcription',
  TEXT_TO_SPEECH = 'Text-to-Speech',
  IMAGE_GENERATION = 'Image Generation',
  IMAGE_EDITING = 'Image Editing',
  VIDEO_GENERATION = 'Video Generation',
  WEB_SEARCH = 'Web Search',
  MAP_SEARCH = 'Map Search',
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
  maps?: {
    uri: string;
    title: string;
    placeAnswerSources?: {
        reviewSnippets: {
            uri: string;
            text: string;
        }[];
    }[]
  };
}
