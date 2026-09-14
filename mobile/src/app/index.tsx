import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Send, Bot, User, Mic, Square, Play, Pause, Volume2 } from 'lucide-react-native';
import Markdown from 'react-native-markdown-display';
import { 
  useAudioRecorder, 
  RecordingPresets, 
  requestRecordingPermissionsAsync, 
  setAudioModeAsync, 
  createAudioPlayer 
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'lucy';
  audioUri?: string;
  isAudio?: boolean;
}

// ⚠️ CAMBIA ESTA IP POR LA IP LOCAL DE TU SERVIDOR
const BASE_URL = 'http://2.24.222.149:3001';
const API_URL = `${BASE_URL}/api/chat`;
const API_AUDIO_URL = `${BASE_URL}/api/chat/audio`;
const API_TTS_URL = `${BASE_URL}/api/tts`;

const WAVEFORM_BARS = [6, 12, 20, 10, 16, 24, 14, 22, 18, 12, 16, 22, 10, 18, 14, 8];

const formatSeconds = (sec: number) => {
  if (isNaN(sec) || sec < 0) return '0:00';
  const mins = Math.floor(sec / 60);
  const remSecs = Math.floor(sec % 60);
  return `${mins}:${remSecs < 10 ? '0' : ''}${remSecs}`;
};

export default function Index() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRecording, setIsRecording] = useState(false);

  // Audio Playback States
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackPosition, setPlaybackPosition] = useState<number>(0);
  const [playbackDuration, setPlaybackDuration] = useState<number>(0);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const currentPlayerRef = useRef<any>(null);
  const statusSubscriptionRef = useRef<any>(null);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    fetchHistory();
    setupAudio();

    return () => {
      stopCurrentAudio();
    };
  }, []);

  const setupAudio = async () => {
    try {
      await requestRecordingPermissionsAsync();
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
    } catch (err) {
      console.warn("Failed to set up audio permissions:", err);
    }
  };

  const stopCurrentAudio = () => {
    if (statusSubscriptionRef.current) {
      try {
        statusSubscriptionRef.current.remove();
      } catch (e) {}
      statusSubscriptionRef.current = null;
    }
    if (currentPlayerRef.current) {
      try {
        currentPlayerRef.current.pause();
        currentPlayerRef.current.remove();
      } catch (e) {}
      currentPlayerRef.current = null;
    }
    setActiveAudioId(null);
    setIsPlaying(false);
    setPlaybackPosition(0);
    setPlaybackDuration(0);
  };

  const playAudioFromUri = async (uri: string, messageId: string) => {
    stopCurrentAudio();
    try {
      const player = createAudioPlayer(uri);
      currentPlayerRef.current = player;
      setActiveAudioId(messageId);
      setIsPlaying(true);
      setPlaybackPosition(0);
      setPlaybackDuration(player.duration || 0);

      const sub = player.addListener('playbackStatusUpdate', (status: any) => {
        setIsPlaying(status.playing);
        setPlaybackPosition(status.currentTime || 0);
        if (status.duration && status.duration > 0) {
          setPlaybackDuration(status.duration);
        }
        if (status.didJustFinish) {
          setIsPlaying(false);
          setPlaybackPosition(0);
          setActiveAudioId(null);
        }
      });
      statusSubscriptionRef.current = sub;
      player.play();
    } catch (err) {
      console.error("Error playing audio from URI:", err);
      stopCurrentAudio();
    }
  };

  const togglePlayAudio = async (msg: Message) => {
    // Si este audio ya está activo y reproduciéndose o pausado
    if (activeAudioId === msg.id && currentPlayerRef.current) {
      if (isPlaying) {
        currentPlayerRef.current.pause();
        setIsPlaying(false);
      } else {
        currentPlayerRef.current.play();
        setIsPlaying(true);
      }
      return;
    }

    // Detener cualquier audio previo
    stopCurrentAudio();

    let targetUri = msg.audioUri;

    // Si es un mensaje de Lucy sin audio local guardado, sintetizamos con TTS on-demand
    if (!targetUri && msg.sender === 'lucy' && msg.text) {
      setLoadingAudioId(msg.id);
      try {
        const response = await fetch(API_TTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: msg.text }),
        });
        const data: any = await response.json();
        if (data.audioBase64) {
          targetUri = `${FileSystem.documentDirectory}lucy_tts_${msg.id}_${Date.now()}.wav`;
          await FileSystem.writeAsStringAsync(targetUri, data.audioBase64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, audioUri: targetUri, isAudio: true } : m));
        }
      } catch (err) {
        console.error("Error requesting TTS:", err);
      } finally {
        setLoadingAudioId(null);
      }
    }

    if (targetUri) {
      await playAudioFromUri(targetUri, msg.id);
    }
  };

  const startRecording = async () => {
    // Detener reproducción previa al empezar a grabar
    stopCurrentAudio();
    try {
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const stopRecording = async () => {
    setIsRecording(false);
    setIsLoading(true);
    try {
      audioRecorder.stop();
      // Pequeña espera para asegurar que el archivo se ha volcado al sistema de archivos
      await new Promise(r => setTimeout(r, 150));
      
      const rawUri = audioRecorder.uri;
      
      if (rawUri) {
        // Copiar a almacenamiento persistente para que no se sobreescriba en futuras notas
        const persistentUserUri = `${FileSystem.documentDirectory}user_audio_${Date.now()}.m4a`;
        try {
          await FileSystem.copyAsync({
            from: rawUri,
            to: persistentUserUri,
          });
        } catch (copyErr) {
          console.warn("Could not copy user audio to persistent storage:", copyErr);
        }

        const userMsgId = Date.now().toString();
        const userMessage: Message = {
          id: userMsgId,
          text: "🎤 Procesando audio...",
          sender: 'user',
          audioUri: persistentUserUri,
          isAudio: true,
        };
        setMessages(prev => [...prev, userMessage]);

        const response = await FileSystem.uploadAsync(API_AUDIO_URL, rawUri, {
          fieldName: 'audio',
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          parameters: {
            thread_id: 'mobile-user'
          }
        });

        const data: any = JSON.parse(response.body);
        
        // Actualizar la nota de voz del usuario con la transcripción
        setMessages(prev => prev.map(m => m.id === userMsgId ? {
          ...m,
          text: data.transcription ? data.transcription : "Nota de voz"
        } : m));

        // Guardar la respuesta en audio de Lucy
        let lucyAudioUri: string | undefined = undefined;
        const lucyMsgId = (Date.now() + 1).toString();
        if (data.audioBase64) {
          lucyAudioUri = `${FileSystem.documentDirectory}lucy_audio_${lucyMsgId}.wav`;
          await FileSystem.writeAsStringAsync(lucyAudioUri, data.audioBase64, {
            encoding: FileSystem.EncodingType.Base64,
          });
        }

        const lucyMessage: Message = {
          id: lucyMsgId,
          text: data.response || "No pude entender el audio.",
          sender: 'lucy',
          audioUri: lucyAudioUri,
          isAudio: true,
        };
        
        setMessages(prev => [...prev, lucyMessage]);

        // Auto-reproducir la respuesta de voz de Lucy
        if (lucyAudioUri) {
          await playAudioFromUri(lucyAudioUri, lucyMsgId);
        }
      }
    } catch (error) {
      console.error("Error processing recording:", error);
      setMessages(prev => [...prev, { id: Date.now().toString(), text: "Error procesando el audio.", sender: 'lucy' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const API_GET_URL = API_URL.replace('/api/chat', '/api/chat/mobile-user');
      const response = await fetch(API_GET_URL);
      const data: any = await response.json();
      
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages);
      } else {
        setMessages([{ id: '1', text: '¡Hola! Soy Lucy 🤖. ¿En qué puedo ayudarte hoy?', sender: 'lucy' }]);
      }
    } catch (error) {
      setMessages([{ id: '1', text: '¡Hola! Soy Lucy 🤖. ¿En qué puedo ayudarte hoy? (Modo Sin Conexión)', sender: 'lucy' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!inputText.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputText.trim(),
      sender: 'user'
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setIsLoading(true);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: userMessage.text,
          thread_id: 'mobile-user'
        })
      });
      
      const data: any = await response.json();
      
      const lucyMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: data.response || "Hubo un error al procesar tu solicitud.",
        sender: 'lucy'
      };
      
      setMessages(prev => [...prev, lucyMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "Error de conexión. Verifica que la IP en API_URL sea la de tu PC, y que ambos dispositivos estén en la misma red WiFi.",
        sender: 'lucy'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.sender === 'user';
    const isThisActive = activeAudioId === item.id;
    const progress = (isThisActive && playbackDuration > 0) ? (playbackPosition / playbackDuration) : 0;
    const hasAudio = !!item.audioUri || item.isAudio;
    const isLucyText = !isUser && !hasAudio;

    return (
      <View style={[styles.messageWrapper, isUser ? styles.messageWrapperUser : styles.messageWrapperLucy]}>
        {!isUser && (
          <View style={styles.avatarLucy}>
            <Bot color="#fff" size={20} />
          </View>
        )}
        <View style={[
          styles.messageBubble, 
          isUser ? styles.messageBubbleUser : styles.messageBubbleLucy,
          hasAudio && styles.messageBubbleAudio
        ]}>
          {/* Reproductor de Audio si el mensaje es de voz */}
          {hasAudio && (
            <View style={styles.audioPlayerContainer}>
              <TouchableOpacity
                style={[
                  styles.audioPlayButton,
                  isUser ? styles.audioPlayButtonUser : styles.audioPlayButtonLucy
                ]}
                onPress={() => togglePlayAudio(item)}
                disabled={loadingAudioId === item.id}
              >
                {loadingAudioId === item.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : isThisActive && isPlaying ? (
                  <Pause color="#fff" size={18} fill="#fff" />
                ) : (
                  <Play color="#fff" size={18} fill="#fff" style={{ marginLeft: 2 }} />
                )}
              </TouchableOpacity>

              <View style={styles.audioWaveformSection}>
                <View style={styles.waveformBarsRow}>
                  {WAVEFORM_BARS.map((height, i) => {
                    const barProgress = (i + 1) / WAVEFORM_BARS.length;
                    const isBarFilled = isThisActive && progress >= barProgress;
                    return (
                      <View
                        key={i}
                        style={[
                          styles.waveformBar,
                          { height: height },
                          isBarFilled ? styles.waveformBarFilled : styles.waveformBarEmpty,
                          isUser && isBarFilled ? styles.waveformBarFilledUser : null,
                        ]}
                      />
                    );
                  })}
                </View>

                <View style={styles.audioInfoRow}>
                  <Text style={[styles.audioTimeText, isUser ? styles.audioTimeTextUser : styles.audioTimeTextLucy]}>
                    {isThisActive ? formatSeconds(playbackPosition) : (isUser ? 'Nota de voz enviada' : 'Audio de Lucy')}
                  </Text>
                  {isThisActive && playbackDuration > 0 && (
                    <Text style={[styles.audioTimeText, isUser ? styles.audioTimeTextUser : styles.audioTimeTextLucy]}>
                      {formatSeconds(playbackDuration)}
                    </Text>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* Texto del mensaje / transcripción */}
          {item.text && item.text !== "🎤 Procesando audio..." && (
            <View style={hasAudio ? styles.transcriptionContainer : null}>
              {isUser ? (
                <Text style={[styles.messageText, styles.messageTextUser]}>
                  {item.text}
                </Text>
              ) : (
                <Markdown style={markdownStyles}>
                  {item.text}
                </Markdown>
              )}
            </View>
          )}

          {/* Botón de "Escuchar" para mensajes normales de texto de Lucy */}
          {isLucyText && (
            <TouchableOpacity 
              style={styles.listenButton}
              onPress={() => togglePlayAudio(item)}
              disabled={loadingAudioId === item.id}
            >
              {loadingAudioId === item.id ? (
                <ActivityIndicator size="small" color="#a78bfa" />
              ) : (
                <>
                  <Volume2 color="#a78bfa" size={15} />
                  <Text style={styles.listenButtonText}>Escuchar</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
        {isUser && (
          <View style={styles.avatarUser}>
            <User color="#fff" size={20} />
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Lucy AI</Text>
        <View style={styles.statusDot} />
      </View>

      {/* Chat List */}
      <KeyboardAvoidingView 
        style={styles.chatContainer} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        {/* Loading Indicator */}
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#8B5CF6" />
            <Text style={styles.loadingText}>Lucy está pensando...</Text>
          </View>
        )}

        {/* Input Area */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Escribe un mensaje o envía un audio..."
            placeholderTextColor="#6b7280"
            value={inputText}
            onChangeText={setInputText}
            multiline
          />
          <TouchableOpacity 
            style={[styles.sendButton, (!inputText.trim() && !isRecording) && styles.sendButtonDisabled]} 
            onPress={inputText.trim() ? sendMessage : (isRecording ? stopRecording : startRecording)}
            disabled={isLoading && !isRecording}
          >
            {inputText.trim() ? (
              <Send color="#fff" size={20} />
            ) : isRecording ? (
              <Square color="#ef4444" size={20} fill="#ef4444" />
            ) : (
              <Mic color="#fff" size={20} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginLeft: 8,
    marginTop: 2,
  },
  chatContainer: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 24,
  },
  messageWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  messageWrapperUser: {
    justifyContent: 'flex-end',
  },
  messageWrapperLucy: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '75%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  messageBubbleAudio: {
    minWidth: 240,
    maxWidth: '85%',
  },
  messageBubbleUser: {
    backgroundColor: '#8B5CF6',
    borderBottomRightRadius: 4,
  },
  messageBubbleLucy: {
    backgroundColor: '#27272a',
    borderBottomLeftRadius: 4,
  },
  audioPlayerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  audioPlayButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  audioPlayButtonUser: {
    backgroundColor: '#6D28D9',
  },
  audioPlayButtonLucy: {
    backgroundColor: '#8B5CF6',
  },
  audioWaveformSection: {
    flex: 1,
    justifyContent: 'center',
  },
  waveformBarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 26,
    gap: 3,
  },
  waveformBar: {
    width: 3.5,
    borderRadius: 2,
  },
  waveformBarFilled: {
    backgroundColor: '#A78BFA',
  },
  waveformBarFilledUser: {
    backgroundColor: '#ffffff',
  },
  waveformBarEmpty: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  audioInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  audioTimeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  audioTimeTextUser: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  audioTimeTextLucy: {
    color: '#a1a1aa',
  },
  transcriptionContainer: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: 8,
  },
  listenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    gap: 4,
  },
  listenButtonText: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '600',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 24,
  },
  messageTextUser: {
    color: '#fff',
  },
  messageTextLucy: {
    color: '#e4e4e7',
  },
  avatarLucy: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#3f3f46',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  avatarUser: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#4c1d95',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  loadingText: {
    color: '#a1a1aa',
    marginLeft: 8,
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 12 : 24,
    backgroundColor: '#18181b',
    borderTopWidth: 1,
    borderTopColor: '#27272a',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: '#27272a',
    color: '#fff',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 14,
    fontSize: 16,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: '#8B5CF6',
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
    marginBottom: 2,
  },
  sendButtonDisabled: {
    backgroundColor: '#3f3f46',
  }
});

const markdownStyles = StyleSheet.create({
  body: {
    color: '#e4e4e7',
    fontSize: 16,
    lineHeight: 24,
    margin: 0,
  },
  strong: {
    fontWeight: 'bold',
    color: '#fff',
  },
  em: {
    fontStyle: 'italic',
  },
  list_item: {
    marginTop: 4,
    marginBottom: 4,
  },
  bullet_list: {
    marginBottom: 8,
  },
  ordered_list: {
    marginBottom: 8,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 8,
  }
});
