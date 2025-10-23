import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Chat, GenerateContentResponse, LiveSession, LiveServerMessage, Modality, Type, FunctionDeclaration, Blob, VideosOperation } from '@google/genai';
import { Feature, ChatMessage, GroundingChunk } from './types';
import { fileToBase64, getMimeType, encodeAudio, decodeAudio, decodeAudioData, useRecorder, usePersistentState } from './utils';
import { IconMenu, IconClose, IconChat, IconSparkles, IconBrain, IconPhoto, IconVideo, IconWave, IconMic, IconSpeaker, IconWand, IconGlobe, IconMap, IconTrash } from './components/icons';

// --- HELPER & UI COMPONENTS ---

const LoadingSpinner: React.FC = () => (
    <div className="flex justify-center items-center my-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
    </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h2 className="text-2xl font-bold text-cyan-400 mb-4">{children}</h2>
);

interface FileUploaderProps {
    onFileSelect: (file: File) => void;
    accept: string;
    label: string;
    icon: React.ReactNode;
}
const FileUploader: React.FC<FileUploaderProps> = ({ onFileSelect, accept, label, icon }) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            onFileSelect(file);
            setFileName(file.name);
        }
    };

    const handleClick = () => {
        fileInputRef.current?.click();
    };
    
    // Effect to clear filename when the parent component clears the file
    useEffect(() => {
        if (!fileInputRef.current?.value) {
            setFileName(null);
        }
    }, [fileInputRef.current?.value]);


    return (
        <div className="w-full">
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept={accept}
                className="hidden"
            />
            <button
                onClick={handleClick}
                className="w-full bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold py-3 px-4 rounded-lg transition duration-300 ease-in-out flex items-center justify-center"
            >
                {icon} {fileName || label}
            </button>
        </div>
    );
};


// --- FEATURE COMPONENTS ---

// Chatbot Feature
const Chatbot: React.FC<{ gemini: GoogleGenAI | null }> = ({ gemini }) => {
    const [chat, setChat] = useState<Chat | null>(null);
    const [messages, setMessages] = usePersistentState<ChatMessage[]>('chatbot_messages', []);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (gemini) {
            const newChat = gemini.chats.create({ 
                model: 'gemini-2.5-flash',
                history: messages.map(msg => ({
                    role: msg.role,
                    parts: [{ text: msg.text }]
                }))
            });
            setChat(newChat);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gemini]);
    
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || !chat || isLoading) return;
        const userMessage: ChatMessage = { role: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const stream = await chat.sendMessageStream({ message: input });
            let modelResponse = '';
            setMessages(prev => [...prev, { role: 'model', text: '' }]);
            for await (const chunk of stream) {
                modelResponse += chunk.text;
                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1].text = modelResponse;
                    return newMessages;
                });
            }
        } catch (error) {
            console.error(error);
            setMessages(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>
            <SectionTitle>Chatbot</SectionTitle>
            <div className="bg-slate-800 rounded-lg p-4 h-[60vh] overflow-y-auto mb-4 flex flex-col space-y-4">
                {messages.map((msg, index) => (
                    <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-xl p-3 rounded-lg ${msg.role === 'user' ? 'bg-cyan-600 text-white' : 'bg-slate-700'}`}>
                           <pre className="whitespace-pre-wrap font-sans">{msg.text}</pre>
                        </div>
                    </div>
                ))}
                {isLoading && messages.length > 0 && messages[messages.length-1].role === 'user' && (
                    <div className="flex justify-start">
                         <div className="max-w-xl p-3 rounded-lg bg-slate-700">
                            <LoadingSpinner />
                         </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
            <div className="flex">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    className="flex-grow bg-slate-700 border border-slate-600 rounded-l-lg p-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="Ask me anything..."
                    disabled={isLoading}
                />
                <button
                    onClick={handleSend}
                    disabled={isLoading || !input.trim()}
                    className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-6 rounded-r-lg disabled:bg-slate-500 transition duration-300"
                >
                    Send
                </button>
            </div>
        </div>
    );
};

// Simple Query Feature
const SimpleQuery: React.FC<{ gemini: GoogleGenAI | null, model: string, title: string, placeholder: string, config?: any }> = ({ gemini, model, title, placeholder, config }) => {
    const keyPrefix = title.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const [prompt, setPrompt] = usePersistentState<string>(`${keyPrefix}_prompt`, '');
    const [result, setResult] = usePersistentState<string>(`${keyPrefix}_result`, '');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async () => {
        if (!prompt.trim() || !gemini) return;
        setIsLoading(true);
        setResult('');
        try {
            const response = await gemini.models.generateContent({ model, contents: prompt, ...config });
            setResult(response.text);
        } catch (error) {
            console.error(error);
            setResult('An error occurred. Please check the console.');
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <div>
            <SectionTitle>{title}</SectionTitle>
            <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={placeholder}
                className="w-full h-40 bg-slate-800 border border-slate-700 rounded-lg p-3 mb-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                disabled={isLoading}
            />
            <button
                onClick={handleSubmit}
                disabled={isLoading || !prompt.trim()}
                className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-slate-500 transition duration-300 w-full"
            >
                {isLoading ? 'Thinking...' : 'Generate'}
            </button>
            {isLoading && <LoadingSpinner />}
            {result && (
                <div className="mt-6 bg-slate-800 p-4 rounded-lg">
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Result</h3>
                    <pre className="whitespace-pre-wrap font-sans">{result}</pre>
                </div>
            )}
        </div>
    );
};

// Image/Video Understanding
const MediaAnalysis: React.FC<{ gemini: GoogleGenAI | null, type: 'image' | 'video' }> = ({ gemini, type }) => {
    const keyPrefix = `${type}_analysis`;
    const [file, setFile] = useState<File | null>(null);
    const [prompt, setPrompt] = usePersistentState<string>(`${keyPrefix}_prompt`, '');
    const [result, setResult] = usePersistentState<string>(`${keyPrefix}_result`, '');
    const [isLoading, setIsLoading] = useState(false);
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);

    const handleFileSelect = (selectedFile: File) => {
        setFile(selectedFile);
        setMediaPreview(URL.createObjectURL(selectedFile));
    };

    const handleSubmit = async () => {
        if (!file || !prompt.trim() || !gemini) return;
        setIsLoading(true);
        setResult('');

        try {
            const base64Data = await fileToBase64(file);
            const mimeType = getMimeType(file);
            
            const model = type === 'image' ? 'gemini-2.5-flash' : 'gemini-2.5-pro';

            const response = await gemini.models.generateContent({
                model,
                contents: {
                    parts: [
                        { inlineData: { mimeType, data: base64Data } },
                        { text: prompt }
                    ]
                }
            });
            setResult(response.text);
        } catch (error) {
            console.error(error);
            setResult('An error occurred while analyzing the media.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>
            <SectionTitle>{type === 'image' ? 'Image Understanding' : 'Video Analysis'}</SectionTitle>
            <div className="grid md:grid-cols-2 gap-6 mb-4">
                <FileUploader 
                    onFileSelect={handleFileSelect} 
                    accept={type === 'image' ? "image/*" : "video/*"}
                    label={type === 'image' ? "Select an Image" : "Select a Video"}
                    icon={type === 'image' ? <IconPhoto /> : <IconVideo />}
                />
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={`What do you want to know about this ${type}?`}
                    className="w-full h-full bg-slate-800 border border-slate-700 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-cyan-500 min-h-[52px]"
                    disabled={isLoading}
                />
            </div>
            {mediaPreview && (
                <div className="mb-4 flex justify-center">
                    {type === 'image' ? (
                        <img src={mediaPreview} alt="Preview" className="max-h-64 rounded-lg" />
                    ) : (
                        <video src={mediaPreview} controls className="max-h-64 rounded-lg" />
                    )}
                </div>
            )}
            <button
                onClick={handleSubmit}
                disabled={isLoading || !file || !prompt.trim()}
                className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-slate-500 transition duration-300 w-full"
            >
                {isLoading ? 'Analyzing...' : 'Analyze'}
            </button>
            {isLoading && <LoadingSpinner />}
            {result && (
                <div className="mt-6 bg-slate-800 p-4 rounded-lg">
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Analysis Result</h3>
                    <pre className="whitespace-pre-wrap font-sans">{result}</pre>
                </div>
            )}
        </div>
    );
};


// Image/Video Generation
const AspectRatioSelector: React.FC<{ value: string; onChange: (value: string) => void; options: string[] }> = ({ value, onChange, options }) => (
    <div className="flex items-center space-x-2 bg-slate-800 p-1 rounded-lg">
        {options.map(option => (
            <button
                key={option}
                onClick={() => onChange(option)}
                className={`px-3 py-1 text-sm rounded-md transition ${value === option ? 'bg-cyan-600 text-white' : 'hover:bg-slate-700'}`}
            >
                {option}
            </button>
        ))}
    </div>
);

const ImageGenerator: React.FC<{ gemini: GoogleGenAI | null }> = ({ gemini }) => {
    const [prompt, setPrompt] = usePersistentState<string>('image_gen_prompt', '');
    const [aspectRatio, setAspectRatio] = usePersistentState<string>('image_gen_aspectRatio', '1:1');
    const [images, setImages] = usePersistentState<string[]>('image_gen_images', []);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async () => {
        if (!prompt.trim() || !gemini) return;
        setIsLoading(true);
        setImages([]);
        try {
            const response = await gemini.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt,
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/jpeg',
                    aspectRatio: aspectRatio as "1:1" | "3:4" | "4:3" | "9:16" | "16:9",
                },
            });
            const generatedImages = response.generatedImages.map(img => `data:image/jpeg;base64,${img.image.imageBytes}`);
            setImages(generatedImages);
        } catch (error) {
            console.error(error);
            alert('Failed to generate image. See console for details.');
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <div>
            <SectionTitle>Image Generation</SectionTitle>
            <div className="space-y-4">
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., A majestic lion wearing a crown, photorealistic"
                    className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    disabled={isLoading}
                />
                <div className="flex justify-between items-center">
                    <span className="text-slate-400">Aspect Ratio:</span>
                    <AspectRatioSelector
                        value={aspectRatio}
                        onChange={setAspectRatio}
                        options={["1:1", "16:9", "9:16", "4:3", "3:4"]}
                    />
                </div>
                <button
                    onClick={handleSubmit}
                    disabled={isLoading || !prompt.trim()}
                    className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-slate-500 transition duration-300 w-full"
                >
                    {isLoading ? 'Generating...' : 'Generate Image'}
                </button>
            </div>
            {isLoading && <LoadingSpinner />}
            {images.length > 0 && (
                <div className="mt-6">
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Generated Image</h3>
                    <div className="grid grid-cols-1 gap-4">
                        {images.map((src, index) => <img key={index} src={src} alt={`Generated ${index}`} className="rounded-lg w-full" />)}
                    </div>
                </div>
            )}
        </div>
    );
};


const ImageEditor: React.FC<{ gemini: GoogleGenAI | null }> = ({ gemini }) => {
    const [file, setFile] = useState<File | null>(null);
    const [prompt, setPrompt] = usePersistentState<string>('image_editor_prompt', '');
    const [originalImage, setOriginalImage] = useState<string | null>(null);
    const [editedImage, setEditedImage] = usePersistentState<string | null>('image_editor_editedImage', null);
    const [isLoading, setIsLoading] = useState(false);

    const handleFileSelect = (selectedFile: File) => {
        setFile(selectedFile);
        setEditedImage(null);
        setOriginalImage(URL.createObjectURL(selectedFile));
    };

    const handleSubmit = async () => {
        if (!file || !prompt.trim() || !gemini) return;
        setIsLoading(true);
        setEditedImage(null);
        try {
            const base64Data = await fileToBase64(file);
            const mimeType = getMimeType(file);

            const response = await gemini.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: {
                    parts: [
                        { inlineData: { data: base64Data, mimeType } },
                        { text: prompt },
                    ],
                },
                config: { responseModalities: [Modality.IMAGE] },
            });
            
            const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (imagePart && imagePart.inlineData) {
                setEditedImage(`data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`);
            } else {
                alert('Could not find image in response.');
            }
        } catch (error) {
            console.error(error);
            alert('Failed to edit image. See console for details.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>
            <SectionTitle>Image Editing</SectionTitle>
             <div className="space-y-4 mb-4">
                <FileUploader onFileSelect={handleFileSelect} accept="image/*" label="Select Image to Edit" icon={<IconPhoto />} />
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., Add a retro filter, or remove the person in the background"
                    className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    disabled={isLoading || !file}
                />
                <button
                    onClick={handleSubmit}
                    disabled={isLoading || !file || !prompt.trim()}
                    className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-slate-500 transition duration-300 w-full"
                >
                    {isLoading ? 'Editing...' : 'Edit Image'}
                </button>
            </div>
            {isLoading && <LoadingSpinner />}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                <div>
                    <h3 className="text-lg font-semibold text-center mb-2">Original</h3>
                    {originalImage && <img src={originalImage} alt="Original" className="rounded-lg w-full" />}
                </div>
                 <div>
                    <h3 className="text-lg font-semibold text-center mb-2">Edited</h3>
                    {editedImage && <img src={editedImage} alt="Edited" className="rounded-lg w-full" />}
                </div>
            </div>
        </div>
    );
};

// Video Generation
const VideoGenerator: React.FC<{ gemini: GoogleGenAI | null, openKeySelector: () => void, hasKey: boolean, setHasKey: (has: boolean) => void }> = ({ gemini, openKeySelector, hasKey, setHasKey }) => {
    const [prompt, setPrompt] = usePersistentState<string>('video_gen_prompt', '');
    const [file, setFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [aspectRatio, setAspectRatio] = usePersistentState<string>('video_gen_aspectRatio', '16:9');
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('');
    
    const handleFileSelect = (selectedFile: File) => {
        setFile(selectedFile);
        setImagePreview(URL.createObjectURL(selectedFile));
    };

    const handleSubmit = async () => {
        if (!hasKey) {
            openKeySelector();
            return;
        }
        if (!prompt.trim() && !file) {
            alert("Please provide a prompt or an image.");
            return;
        }
        setIsLoading(true);
        setVideoUrl(null);
        setLoadingMessage('Initializing video generation...');
        
        try {
            // Re-create the client instance to use the latest key
            const freshGemini = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            let operation: VideosOperation;

            if (file) {
                const base64Data = await fileToBase64(file);
                const mimeType = getMimeType(file);
                operation = await freshGemini.models.generateVideos({
                    model: 'veo-3.1-fast-generate-preview',
                    prompt: prompt,
                    image: { imageBytes: base64Data, mimeType },
                    config: {
                        numberOfVideos: 1,
                        resolution: '720p',
                        aspectRatio: aspectRatio as '16:9' | '9:16',
                    },
                });
            } else {
                 operation = await freshGemini.models.generateVideos({
                    model: 'veo-3.1-fast-generate-preview',
                    prompt: prompt,
                    config: {
                        numberOfVideos: 1,
                        resolution: '720p',
                        aspectRatio: aspectRatio as '16:9' | '9:16',
                    },
                });
            }
            
            setLoadingMessage('Video generation in progress... this can take a few minutes.');
            
            while (!operation.done) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                operation = await freshGemini.operations.getVideosOperation({ operation: operation });
            }

            const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (downloadLink) {
                 const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
                 const blob = await response.blob();
                 setVideoUrl(URL.createObjectURL(blob));
            } else {
                throw new Error("Video generation completed but no video URI was found.");
            }

        } catch (error: any) {
            console.error(error);
            alert(`Failed to generate video: ${error.message}`);
            if (error.message?.includes('Requested entity was not found')) {
                setHasKey(false);
                openKeySelector(); // Prompt user to re-select key
            }
        } finally {
            setIsLoading(false);
            setLoadingMessage('');
        }
    };
    
    return (
        <div>
            <SectionTitle>Video Generation (Veo)</SectionTitle>
            {!hasKey && (
                <div className="bg-yellow-900 border border-yellow-600 text-yellow-200 px-4 py-3 rounded-lg relative mb-4" role="alert">
                    <strong className="font-bold">API Key Required!</strong>
                    <span className="block sm:inline"> Veo requires a user-provided API key.</span>
                    <button onClick={openKeySelector} className="ml-4 bg-yellow-700 hover:bg-yellow-600 text-white font-bold py-1 px-3 rounded">Select Key</button>
                    <p className="text-sm mt-1">Video generation incurs costs. Please review the <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline">billing documentation</a>.</p>
                </div>
            )}
            <div className="space-y-4">
                <FileUploader onFileSelect={handleFileSelect} accept="image/*" label="Add an optional starting image" icon={<IconPhoto />} />
                {imagePreview && <img src={imagePreview} alt="Preview" className="max-h-40 rounded-lg mx-auto" />}
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., A neon hologram of a cat driving at top speed"
                    className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    disabled={isLoading}
                />
                 <div className="flex justify-between items-center">
                    <span className="text-slate-400">Aspect Ratio:</span>
                    <AspectRatioSelector
                        value={aspectRatio}
                        onChange={setAspectRatio}
                        options={["16:9", "9:16"]}
                    />
                </div>
                <button
                    onClick={handleSubmit}
                    disabled={isLoading || (!prompt.trim() && !file)}
                    className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-slate-500 transition duration-300 w-full"
                >
                    {isLoading ? 'Generating...' : 'Generate Video'}
                </button>
            </div>
            {isLoading && (
                <div className="mt-4 text-center">
                    <LoadingSpinner />
                    <p>{loadingMessage}</p>
                </div>
            )}
            {videoUrl && (
                <div className="mt-6">
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Generated Video</h3>
                    <video src={videoUrl} controls autoPlay loop className="rounded-lg w-full" />
                </div>
            )}
        </div>
    );
};


// Web/Maps Search
const GroundedSearch: React.FC<{ gemini: GoogleGenAI | null, type: 'web' | 'maps' }> = ({ gemini, type }) => {
    const keyPrefix = `${type}_search`;
    const [prompt, setPrompt] = usePersistentState<string>(`${keyPrefix}_prompt`, '');
    const [result, setResult] = usePersistentState<string>(`${keyPrefix}_result`, '');
    const [chunks, setChunks] = usePersistentState<GroundingChunk[]>(`${keyPrefix}_chunks`, []);
    const [isLoading, setIsLoading] = useState(false);
    const [location, setLocation] = useState<{latitude: number; longitude: number} | null>(null);

    useEffect(() => {
        if (type === 'maps') {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setLocation({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                    });
                },
                (error) => {
                    console.warn("Could not get geolocation:", error.message);
                }
            );
        }
    }, [type]);

    const handleSubmit = async () => {
        if (!prompt.trim() || !gemini) return;
        if (type === 'maps' && !location) {
            alert("Geolocation is required for Maps Search. Please allow location access.");
            return;
        }

        setIsLoading(true);
        setResult('');
        setChunks([]);

        try {
            const config: any = {
                tools: type === 'web' ? [{ googleSearch: {} }] : [{ googleMaps: {} }],
            };
            if (type === 'maps' && location) {
                config.toolConfig = { retrievalConfig: { latLng: location } };
            }

            const response = await gemini.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config,
            });

            setResult(response.text);
            const metadata = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (metadata) {
                setChunks(metadata as GroundingChunk[]);
            }
        } catch (error) {
            console.error(error);
            setResult('An error occurred. Please check the console.');
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <div>
            <SectionTitle>{type === 'web' ? 'Web Search' : 'Map Search'}</SectionTitle>
             <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={type === 'web' ? "Ask a question about a recent event..." : "What good Italian restaurants are nearby?"}
                className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-3 mb-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                disabled={isLoading}
            />
            <button
                onClick={handleSubmit}
                disabled={isLoading || !prompt.trim()}
                className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-slate-500 transition duration-300 w-full"
            >
                {isLoading ? 'Searching...' : 'Search'}
            </button>
            {isLoading && <LoadingSpinner />}
            {result && (
                <div className="mt-6 bg-slate-800 p-4 rounded-lg">
                    <h3 className="text-xl font-semibold text-cyan-400 mb-2">Answer</h3>
                    <pre className="whitespace-pre-wrap font-sans">{result}</pre>
                    {chunks.length > 0 && (
                        <div className="mt-4 border-t border-slate-700 pt-4">
                            <h4 className="font-semibold mb-2">Sources:</h4>
                            <ul className="list-disc list-inside space-y-1">
                                {chunks.map((chunk, index) => {
                                    const source = chunk.web || chunk.maps;
                                    return source ? <li key={index}><a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">{source.title}</a></li> : null;
                                })}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Text-to-Speech
const TextToSpeech: React.FC<{ gemini: GoogleGenAI | null }> = ({ gemini }) => {
    const [text, setText] = usePersistentState<string>('tts_text', '');
    const [isLoading, setIsLoading] = useState(false);
    const audioContextRef = useRef<AudioContext | null>(null);

    const handleSubmit = async () => {
        if (!text.trim() || !gemini) return;
        setIsLoading(true);

        try {
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            }
            const audioContext = audioContextRef.current;
            let nextStartTime = 0;

            const stream = await gemini.models.generateContentStream({
                model: 'gemini-2.5-flash-preview-tts',
                contents: [{ parts: [{ text }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                    },
                },
            });

            for await (const chunk of stream) {
                const base64Audio = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                if (base64Audio) {
                    const audioBuffer = await decodeAudioData(decodeAudio(base64Audio), audioContext, 24000, 1);
                    const source = audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(audioContext.destination);
                    
                    const currentTime = audioContext.currentTime;
                    const startTime = nextStartTime > currentTime ? nextStartTime : currentTime;
                    
                    source.start(startTime);
                    
                    nextStartTime = startTime + audioBuffer.duration;
                }
            }
        } catch (error) {
            console.error(error);
            alert("Failed to generate speech. See console for details.");
        } finally {
            setIsLoading(false);
        }
    };
    
    return (
        <div>
            <SectionTitle>Text-to-Speech</SectionTitle>
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter text to convert to speech..."
                className="w-full h-40 bg-slate-800 border border-slate-700 rounded-lg p-3 mb-4 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                disabled={isLoading}
            />
            <button
                onClick={handleSubmit}
                disabled={isLoading || !text.trim()}
                className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-slate-500 transition duration-300 w-full"
            >
                {isLoading ? <LoadingSpinner /> : 'Generate & Play Speech'}
            </button>
        </div>
    );
};


// Audio Transcription
const AudioTranscription: React.FC<{ gemini: GoogleGenAI | null }> = ({ gemini }) => {
    const [transcription, setTranscription] = usePersistentState<string>('audio_transcription_text', '');
    const [isTranscribing, setIsTranscribing] = useState(false);
    const sessionRef = useRef<LiveSession | null>(null);

    const onDataAvailable = useCallback((data: Float32Array) => {
        const session = sessionRef.current;
        if (!session) return;
        const l = data.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
            int16[i] = data[i] * 32768;
        }
        const pcmBlob: Blob = {
            data: encodeAudio(new Uint8Array(int16.buffer)),
            mimeType: 'audio/pcm;rate=16000',
        };
        session.sendRealtimeInput({ media: pcmBlob });
    }, []);

    const { isRecording, startRecording, stopRecording } = useRecorder({ onDataAvailable });

    const startTranscription = async () => {
        if (!gemini) return;
        setIsTranscribing(true);
        setTranscription('');
        
        const sessionPromise = gemini.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: async () => {
                   console.log('Transcription session opened.');
                   await startRecording();
                },
                onmessage: (message: LiveServerMessage) => {
                    if (message.serverContent?.inputTranscription) {
                        const text = message.serverContent.inputTranscription.text;
                        setTranscription(prev => prev + text);
                    }
                },
                onerror: (e: ErrorEvent) => console.error('Transcription error:', e),
                onclose: () => console.log('Transcription session closed.'),
            },
            config: {
                inputAudioTranscription: {},
                responseModalities: [Modality.AUDIO],
            },
        });

        sessionRef.current = await sessionPromise;
    };

    const stopTranscription = () => {
        stopRecording();
        sessionRef.current?.close();
        sessionRef.current = null;
        setIsTranscribing(false);
    };

    return (
        <div>
            <SectionTitle>Audio Transcription</SectionTitle>
            <button
                onClick={isTranscribing ? stopTranscription : startTranscription}
                className={`w-full py-3 px-6 font-bold rounded-lg transition duration-300 flex items-center justify-center ${
                    isTranscribing
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-cyan-600 hover:bg-cyan-700'
                }`}
            >
                <IconMic /> {isTranscribing ? 'Stop Transcribing' : 'Start Transcribing'}
            </button>
            <div className="mt-6 bg-slate-800 p-4 rounded-lg min-h-[200px]">
                <h3 className="text-xl font-semibold text-cyan-400 mb-2">Transcription</h3>
                <p className="whitespace-pre-wrap font-sans">{transcription || '...'}</p>
            </div>
        </div>
    );
};


// Live Conversation
const LiveConversation: React.FC<{ gemini: GoogleGenAI | null }> = ({ gemini }) => {
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [transcripts, setTranscripts] = usePersistentState<ChatMessage[]>('live_conversation_transcripts', []);
    const sessionRef = useRef<LiveSession | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    let nextStartTime = 0;

    const playAudio = async (base64Audio: string) => {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;
        nextStartTime = Math.max(nextStartTime, ctx.currentTime);

        const audioBuffer = await decodeAudioData(decodeAudio(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start(nextStartTime);
        nextStartTime += audioBuffer.duration;
    };

    const onDataAvailable = useCallback((data: Float32Array) => {
        const session = sessionRef.current;
        if (!session) return;
        const l = data.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
            int16[i] = data[i] * 32768;
        }
        const pcmBlob: Blob = {
            data: encodeAudio(new Uint8Array(int16.buffer)),
            mimeType: 'audio/pcm;rate=16000',
        };
        session.sendRealtimeInput({ media: pcmBlob });
    }, []);

    const { isRecording, startRecording, stopRecording } = useRecorder({ onDataAvailable });
    
    const startSession = async () => {
        if (!gemini) return;
        setIsSessionActive(true);
        setTranscripts([]);
        let currentInput = '';
        let currentOutput = '';
        
        const sessionPromise = gemini.live.connect({
            model: 'gemini-2.5-flash-native-audio-preview-09-2025',
            callbacks: {
                onopen: async () => {
                   console.log('Live session opened.');
                   await startRecording();
                },
                onmessage: async (message: LiveServerMessage) => {
                    if (message.serverContent?.inputTranscription) {
                        currentInput += message.serverContent.inputTranscription.text;
                    }
                    if (message.serverContent?.outputTranscription) {
                        currentOutput += message.serverContent.outputTranscription.text;
                    }
                    if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
                       await playAudio(message.serverContent.modelTurn.parts[0].inlineData.data);
                    }
                    if(message.serverContent?.turnComplete) {
                        setTranscripts(prev => [...prev, {role: 'user', text: currentInput}, {role: 'model', text: currentOutput}]);
                        currentInput = '';
                        currentOutput = '';
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error('Live session error:', e);
                    stopSession();
                },
                onclose: () => {
                    console.log('Live session closed.');
                    stopSession();
                },
            },
            config: { 
                responseModalities: [Modality.AUDIO],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
            }
        });
        sessionRef.current = await sessionPromise;
    };

    const stopSession = () => {
        stopRecording();
        sessionRef.current?.close();
        sessionRef.current = null;
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
        }
        setIsSessionActive(false);
    };

    return (
        <div>
            <SectionTitle>Live Conversation</SectionTitle>
            <button
                onClick={isSessionActive ? stopSession : startSession}
                className={`w-full py-4 px-6 font-bold rounded-lg transition duration-300 flex items-center justify-center text-xl ${
                    isSessionActive
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-cyan-600 hover:bg-cyan-700'
                }`}
            >
                {isSessionActive ? 'End Conversation' : 'Start Conversation'}
            </button>
             <div className="bg-slate-800 rounded-lg p-4 h-[60vh] overflow-y-auto mt-4 flex flex-col space-y-4">
                {transcripts.map((msg, index) => (
                    <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-xl p-3 rounded-lg ${msg.role === 'user' ? 'bg-cyan-600 text-white' : 'bg-slate-700'}`}>
                           <p><strong className="capitalize">{msg.role}:</strong> {msg.text}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- MAIN APP ---
export default function App() {
    const [activeFeature, setActiveFeature] = usePersistentState<Feature>('app_active_feature', Feature.CHATBOT);
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [gemini, setGemini] = useState<GoogleGenAI | null>(null);
    const [hasVeoApiKey, setHasVeoApiKey] = useState(false);

    useEffect(() => {
        if (process.env.API_KEY) {
            setGemini(new GoogleGenAI({ apiKey: process.env.API_KEY }));
        }
        checkVeoApiKey();
    }, []);
    
    const checkVeoApiKey = async () => {
        if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
            setHasVeoApiKey(true);
        } else {
            setHasVeoApiKey(false);
        }
    };
    
    const openVeoKeySelector = async () => {
        if (window.aistudio) {
            await window.aistudio.openSelectKey();
            // Assume success to avoid race conditions, and re-check.
            setHasVeoApiKey(true);
        }
    };

    const features: { name: Feature; icon: React.FC }[] = [
        { name: Feature.CHATBOT, icon: IconChat },
        { name: Feature.QUICK_QUERY, icon: IconSparkles },
        { name: Feature.COMPLEX_QUERY, icon: IconBrain },
        { name: Feature.IMAGE_UNDERSTANDING, icon: IconPhoto },
        { name: Feature.VIDEO_ANALYSIS, icon: IconVideo },
        { name: Feature.LIVE_CONVERSATION, icon: IconWave },
        { name: Feature.AUDIO_TRANSCRIPTION, icon: IconMic },
        { name: Feature.TEXT_TO_SPEECH, icon: IconSpeaker },
        { name: Feature.IMAGE_GENERATION, icon: IconSparkles },
        { name: Feature.IMAGE_EDITING, icon: IconWand },
        { name: Feature.VIDEO_GENERATION, icon: IconVideo },
        { name: Feature.WEB_SEARCH, icon: IconGlobe },
        { name: Feature.MAP_SEARCH, icon: IconMap },
    ];
    
    const renderActiveFeature = () => {
        if (!gemini && activeFeature !== Feature.VIDEO_GENERATION) {
             return <div className="text-center p-8"><p className="text-xl text-yellow-400">API_KEY is not configured. Please set it up to use this application.</p></div>;
        }
        
        switch (activeFeature) {
            case Feature.CHATBOT:
                return <Chatbot gemini={gemini} />;
            case Feature.QUICK_QUERY:
                return <SimpleQuery gemini={gemini} model="gemini-2.5-flash-lite" title="Quick Query (Low-Latency)" placeholder="Ask a quick question for a fast response..."/>;
            case Feature.COMPLEX_QUERY:
                 return <SimpleQuery gemini={gemini} model="gemini-2.5-pro" title="Complex Query (Thinking Mode)" placeholder="Enter a complex prompt requiring deep reasoning..." config={{ config: { thinkingConfig: { thinkingBudget: 32768 } } }} />;
            case Feature.IMAGE_UNDERSTANDING:
                return <MediaAnalysis gemini={gemini} type="image" />;
            case Feature.VIDEO_ANALYSIS:
                return <MediaAnalysis gemini={gemini} type="video" />;
            case Feature.IMAGE_GENERATION:
                return <ImageGenerator gemini={gemini} />;
            case Feature.IMAGE_EDITING:
                return <ImageEditor gemini={gemini} />;
            case Feature.VIDEO_GENERATION:
                 return <VideoGenerator gemini={gemini} openKeySelector={openVeoKeySelector} hasKey={hasVeoApiKey} setHasKey={setHasVeoApiKey} />;
            case Feature.WEB_SEARCH:
                return <GroundedSearch gemini={gemini} type="web" />;
            case Feature.MAP_SEARCH:
                 return <GroundedSearch gemini={gemini} type="maps" />;
            case Feature.TEXT_TO_SPEECH:
                return <TextToSpeech gemini={gemini} />;
            case Feature.AUDIO_TRANSCRIPTION:
                return <AudioTranscription gemini={gemini} />;
            case Feature.LIVE_CONVERSATION:
                return <LiveConversation gemini={gemini} />;
            default:
                return <p>Select a feature to get started.</p>;
        }
    };
    
    const SidebarContent = () => (
        <div className="flex flex-col h-full">
            <nav className="p-4 flex-grow">
                <h1 className="text-2xl font-bold mb-6 text-white flex items-center">
                    <IconSparkles /> AI Hassel
                </h1>
                <ul>
                    {features.map(({ name, icon: Icon }) => (
                        <li key={name}>
                            <button
                                onClick={() => { setActiveFeature(name); setSidebarOpen(false); }}
                                className={`w-full text-left flex items-center px-3 py-3 rounded-lg transition-colors duration-200 ${
                                    activeFeature === name
                                        ? 'bg-cyan-600 text-white'
                                        : 'hover:bg-slate-700 text-slate-300'
                                }`}
                            >
                                <Icon /> {name}
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>
            <div className="p-4 border-t border-slate-700">
                 <button
                    onClick={() => {
                        if (confirm('Are you sure you want to clear all saved data? This action cannot be undone.')) {
                            localStorage.clear();
                            window.location.reload();
                        }
                    }}
                    className="w-full text-left flex items-center px-3 py-3 rounded-lg text-slate-400 hover:bg-red-800 hover:text-white transition-colors duration-200"
                >
                    <IconTrash /> Clear Saved Data
                </button>
            </div>
        </div>

    );

    return (
        <div className="flex h-screen bg-slate-900 text-slate-100">
            {/* Mobile Sidebar */}
            <div className={`fixed inset-0 z-30 transform ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"} transition-transform duration-300 ease-in-out md:hidden`}>
                <div className="relative w-64 h-full bg-slate-800 shadow-lg">
                    <SidebarContent />
                    <button onClick={() => setSidebarOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
                        <IconClose />
                    </button>
                </div>
                <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 bg-black/60 z-20"></div>
            </div>
            
            {/* Desktop Sidebar */}
            <aside className="hidden md:block w-64 bg-slate-800 flex-shrink-0">
                <SidebarContent />
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col overflow-hidden">
                <header className="bg-slate-800 md:bg-slate-900 shadow-md md:shadow-none p-4 flex items-center">
                     <button onClick={() => setSidebarOpen(true)} className="md:hidden mr-4 text-slate-300">
                        <IconMenu />
                    </button>
                    <h2 className="text-xl font-semibold text-white">{activeFeature}</h2>
                </header>
                <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
                    {renderActiveFeature()}
                </div>
            </main>
        </div>
    );
}