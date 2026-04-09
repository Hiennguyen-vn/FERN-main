package com.natsu.common.model.message;

import java.io.*;
import java.net.ServerSocket;
import java.net.Socket;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.*;

/**
 * Socket-based message queue for distributed messaging between processes.
 * Supports both TCP server and client modes.
 */
public class SocketMessageQueue extends AbstractMessageQueue {

    private final String host;
    private final int port;
    private final boolean serverMode;
    private final Map<String, BlockingQueue<Message<?>>> queues = new ConcurrentHashMap<>();
    
    private ServerSocket serverSocket;
    private Socket clientSocket;
    private final CopyOnWriteArrayList<ClientConnection> clients = new CopyOnWriteArrayList<>();
    private ExecutorService serverExecutor;

    /**
     * Creates a socket message queue in client mode.
     *
     * @param host the server host
     * @param port the server port
     */
    public static SocketMessageQueue client(String host, int port) {
        return new SocketMessageQueue("socket-client", host, port, false);
    }

    /**
     * Creates a socket message queue in server mode.
     *
     * @param port the port to listen on
     */
    public static SocketMessageQueue server(int port) {
        return new SocketMessageQueue("socket-server", "0.0.0.0", port, true);
    }

    private SocketMessageQueue(String name, String host, int port, boolean serverMode) {
        super(name);
        this.host = host;
        this.port = port;
        this.serverMode = serverMode;
    }

    @Override
    protected <T> void doPublish(Message<T> message) {
        byte[] data = serializeMessage(message);
        
        if (serverMode) {
            // Broadcast to all clients
            for (ClientConnection client : clients) {
                client.send(data);
            }
            // Also dispatch locally
            dispatchMessage(message.getTopic(), message);
        } else {
            // Send to server
            sendToServer(data);
        }
    }

    @Override
    protected <T> void doSend(Message<T> message) {
        // Point-to-point: store in local queue, send to remote
        String queue = message.getTopic();
        byte[] data = serializeMessage(message);
        
        if (serverMode) {
            // Server stores message and sends to one client
            getOrCreateQueue(queue).offer(message);
            if (!clients.isEmpty()) {
                clients.get(0).send(data);
            }
        } else {
            sendToServer(data);
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    protected <T> Optional<Message<T>> doReceive(String queue, Duration timeout) {
        BlockingQueue<Message<?>> q = getOrCreateQueue(queue);
        try {
            Message<?> message;
            if (timeout.isZero()) {
                message = q.poll();
            } else {
                message = q.poll(timeout.toMillis(), TimeUnit.MILLISECONDS);
            }
            return Optional.ofNullable((Message<T>) message);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        }
    }

    @Override
    protected void doSubscribe(String topic, SubscriptionImpl subscription) {
        // Send subscription message to server if in client mode
        if (!serverMode && clientSocket != null) {
            Message<String> subMsg = Message.<String>builder()
                    .topic("__subscribe__")
                    .payload(topic)
                    .build();
            sendToServer(serializeMessage(subMsg));
        }
    }

    @Override
    protected void doStart() {
        if (serverMode) {
            startServer();
        } else {
            connectToServer();
        }
    }

    @Override
    protected void doStop() {
        if (serverMode) {
            stopServer();
        } else {
            disconnectFromServer();
        }
    }

    @Override
    protected void doClose() {
        queues.clear();
        if (serverExecutor != null) {
            serverExecutor.shutdownNow();
        }
    }

    @Override
    public boolean isConnected() {
        if (serverMode) {
            return serverSocket != null && !serverSocket.isClosed();
        } else {
            return clientSocket != null && clientSocket.isConnected();
        }
    }

    @Override
    public long getQueueSize(String queue) {
        BlockingQueue<Message<?>> q = queues.get(queue);
        return q != null ? q.size() : 0;
    }

    private void startServer() {
        serverExecutor = Executors.newCachedThreadPool();
        
        serverExecutor.submit(() -> {
            try {
                serverSocket = new ServerSocket(port);
                System.out.println("Socket server started on port " + port);
                
                while (running.get()) {
                    Socket socket = serverSocket.accept();
                    ClientConnection client = new ClientConnection(socket);
                    clients.add(client);
                    serverExecutor.submit(client::listen);
                }
            } catch (IOException e) {
                if (running.get()) {
                    throw new MessageException("Server error", e);
                }
            }
        });
    }

    private void stopServer() {
        try {
            if (serverSocket != null) {
                serverSocket.close();
            }
            for (ClientConnection client : clients) {
                client.close();
            }
            clients.clear();
        } catch (IOException e) {
            // Ignore on shutdown
        }
    }

    private void connectToServer() {
        try {
            clientSocket = new Socket(host, port);
            
            // Start listener thread
            executor.submit(this::listenToServer);
            
        } catch (IOException e) {
            throw new MessageException("Failed to connect to server", e);
        }
    }

    private void disconnectFromServer() {
        try {
            if (clientSocket != null) {
                clientSocket.close();
            }
        } catch (IOException e) {
            // Ignore on shutdown
        }
    }

    private void listenToServer() {
        try (DataInputStream in = new DataInputStream(clientSocket.getInputStream())) {
            while (running.get() && !clientSocket.isClosed()) {
                int length = in.readInt();
                byte[] data = new byte[length];
                in.readFully(data);
                
                Message<?> message = deserializeMessage(data);
                handleReceivedMessage(message);
            }
        } catch (IOException e) {
            if (running.get()) {
                System.err.println("Connection lost: " + e.getMessage());
            }
        }
    }

    private void handleReceivedMessage(Message<?> message) {
        String topic = message.getTopic();
        
        // Store in queue for receive() calls
        getOrCreateQueue(topic).offer(message);
        
        // Dispatch to subscribers
        dispatchMessage(topic, message);
    }

    private void sendToServer(byte[] data) {
        try {
            DataOutputStream out = new DataOutputStream(clientSocket.getOutputStream());
            out.writeInt(data.length);
            out.write(data);
            out.flush();
        } catch (IOException e) {
            throw new MessageException("Failed to send message", e);
        }
    }

    private <T> byte[] serializeMessage(Message<T> message) {
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ObjectOutputStream oos = new ObjectOutputStream(baos)) {
            oos.writeObject(new SerializableMessage<>(message, serializer));
            return baos.toByteArray();
        } catch (IOException e) {
            throw new MessageException("Failed to serialize message", e);
        }
    }

    @SuppressWarnings("unchecked")
    private Message<?> deserializeMessage(byte[] data) {
        try (ByteArrayInputStream bais = new ByteArrayInputStream(data);
             ObjectInputStream ois = new ObjectInputStream(bais)) {
            SerializableMessage<?> sm = (SerializableMessage<?>) ois.readObject();
            return sm.toMessage(serializer);
        } catch (IOException | ClassNotFoundException e) {
            throw new MessageException("Failed to deserialize message", e);
        }
    }

    private BlockingQueue<Message<?>> getOrCreateQueue(String queue) {
        return queues.computeIfAbsent(queue, k -> new LinkedBlockingQueue<>());
    }

    /**
     * Represents a connected client in server mode.
     */
    private class ClientConnection {
        private final Socket socket;
        private DataOutputStream out;
        private DataInputStream in;

        ClientConnection(Socket socket) {
            this.socket = socket;
            try {
                this.out = new DataOutputStream(socket.getOutputStream());
                this.in = new DataInputStream(socket.getInputStream());
            } catch (IOException e) {
                throw new MessageException("Failed to create client connection", e);
            }
        }

        void send(byte[] data) {
            try {
                synchronized (out) {
                    out.writeInt(data.length);
                    out.write(data);
                    out.flush();
                }
            } catch (IOException e) {
                System.err.println("Failed to send to client: " + e.getMessage());
                close();
            }
        }

        void listen() {
            try {
                while (running.get() && !socket.isClosed()) {
                    int length = in.readInt();
                    byte[] data = new byte[length];
                    in.readFully(data);
                    
                    Message<?> message = deserializeMessage(data);
                    handleReceivedMessage(message);
                }
            } catch (IOException e) {
                if (running.get()) {
                    System.err.println("Client disconnected: " + e.getMessage());
                }
            } finally {
                close();
            }
        }

        void close() {
            clients.remove(this);
            try {
                socket.close();
            } catch (IOException e) {
                // Ignore
            }
        }
    }

    /**
     * Serializable wrapper for messages.
     */
    private static class SerializableMessage<T> implements Serializable {
        private static final long serialVersionUID = 1L;
        
        private final String id;
        private final String topic;
        private final byte[] payloadBytes;
        private final String payloadType;
        private final Map<String, String> headers;
        private final long timestamp;
        private final String correlationId;
        private final String replyTo;
        private final int priority;
        private final Long ttlMillis;

        SerializableMessage(Message<T> message, MessageSerializer serializer) {
            this.id = message.getId();
            this.topic = message.getTopic();
            this.payloadBytes = serializer.serialize(message.getPayload());
            this.payloadType = message.getPayload() != null ? 
                    message.getPayload().getClass().getName() : null;
            this.headers = message.getHeaders();
            this.timestamp = message.getTimestamp().toEpochMilli();
            this.correlationId = message.getCorrelationId();
            this.replyTo = message.getReplyTo();
            this.priority = message.getPriority();
            this.ttlMillis = message.getTtlMillis();
        }

        @SuppressWarnings("unchecked")
        Message<Object> toMessage(MessageSerializer serializer) {
            Object payload = null;
            if (payloadBytes != null && payloadType != null) {
                try {
                    Class<?> type = Class.forName(payloadType);
                    payload = serializer.deserialize(payloadBytes, type);
                } catch (ClassNotFoundException e) {
                    // Fallback to raw bytes
                    payload = payloadBytes;
                }
            }

            return Message.<Object>builder()
                    .id(id)
                    .topic(topic)
                    .payload(payload)
                    .headers(headers)
                    .timestamp(java.time.Instant.ofEpochMilli(timestamp))
                    .correlationId(correlationId)
                    .replyTo(replyTo)
                    .priority(priority)
                    .ttlMillis(ttlMillis)
                    .build();
        }
    }
}
