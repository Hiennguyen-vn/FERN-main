package com.fern.common.utils.registry.lifecycle;

import java.util.concurrent.CompletableFuture;

public interface LifecycleComponent {

    CompletableFuture<Void> start();

    CompletableFuture<Void> stop();

    boolean isRunning();
}
