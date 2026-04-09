package com.natsu.common.model.message;

/**
 * Interface for subscribing to messages from topics/queues.
 */
public interface MessageSubscriber {

    /**
     * Subscribes to a topic with a message handler.
     *
     * @param topic the topic to subscribe to
     * @param handler the message handler
     * @param <T> the payload type
     * @return a subscription that can be cancelled
     */
    <T> Subscription subscribe(String topic, MessageHandler<T> handler);

    /**
     * Subscribes to a topic with a specific payload type.
     *
     * @param topic the topic to subscribe to
     * @param payloadType the expected payload type
     * @param handler the message handler
     * @param <T> the payload type
     * @return a subscription that can be cancelled
     */
    <T> Subscription subscribe(String topic, Class<T> payloadType, MessageHandler<T> handler);

    /**
     * Subscribes to multiple topics with a single handler.
     *
     * @param topics the topics to subscribe to
     * @param handler the message handler
     * @param <T> the payload type
     * @return a subscription that can be cancelled
     */
    default <T> Subscription subscribe(String[] topics, MessageHandler<T> handler) {
        Subscription[] subs = new Subscription[topics.length];
        for (int i = 0; i < topics.length; i++) {
            subs[i] = subscribe(topics[i], handler);
        }
        return new CompositeSubscription(subs);
    }

    /**
     * Represents an active subscription that can be cancelled.
     */
    interface Subscription {
        /**
         * Gets the topic this subscription is for.
         *
         * @return the topic
         */
        String getTopic();

        /**
         * Checks if the subscription is active.
         *
         * @return true if active
         */
        boolean isActive();

        /**
         * Cancels the subscription.
         */
        void cancel();
    }

    /**
     * A subscription that manages multiple underlying subscriptions.
     */
    class CompositeSubscription implements Subscription {
        private final Subscription[] subscriptions;
        private volatile boolean active = true;

        public CompositeSubscription(Subscription[] subscriptions) {
            this.subscriptions = subscriptions;
        }

        @Override
        public String getTopic() {
            return String.join(",", java.util.Arrays.stream(subscriptions)
                    .map(Subscription::getTopic)
                    .toArray(String[]::new));
        }

        @Override
        public boolean isActive() {
            return active;
        }

        @Override
        public void cancel() {
            active = false;
            for (Subscription sub : subscriptions) {
                sub.cancel();
            }
        }
    }
}
