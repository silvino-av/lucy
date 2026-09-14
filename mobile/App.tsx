import React, { useState, useRef } from 'react';
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
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Send, Bot, User } from 'lucide-react-native';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'lucy';
}

// ⚠️ CAMBIA ESTA IP POR LA IP LOCAL DE TU SERVIDOR (ej. 192.168.1.100)
const API_URL = 'http://192.168.1.XX:3000/api/chat';

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: '¡Hola! Soy Lucy 🤖. ¿En qué puedo ayudarte hoy?', sender: 'lucy' }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const flatListRef = useRef<FlatList>(null);

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
      
      const data = await response.json();
      
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
    return (
      <View style={[styles.messageWrapper, isUser ? styles.messageWrapperUser : styles.messageWrapperLucy]}>
        {!isUser && (
          <View style={styles.avatarLucy}>
            <Bot color="#fff" size={20} />
          </View>
        )}
        <View style={[styles.messageBubble, isUser ? styles.messageBubbleUser : styles.messageBubbleLucy]}>
          <Text style={[styles.messageText, isUser ? styles.messageTextUser : styles.messageTextLucy]}>
            {item.text}
          </Text>
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
    <SafeAreaProvider>
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
              placeholder="Escribe un mensaje..."
              placeholderTextColor="#6b7280"
              value={inputText}
              onChangeText={setInputText}
              multiline
            />
            <TouchableOpacity 
              style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]} 
              onPress={sendMessage}
              disabled={!inputText.trim() || isLoading}
            >
              <Send color="#fff" size={20} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
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
    marginBottom: 20,
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
  messageBubbleUser: {
    backgroundColor: '#8B5CF6',
    borderBottomRightRadius: 4,
  },
  messageBubbleLucy: {
    backgroundColor: '#27272a',
    borderBottomLeftRadius: 4,
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
