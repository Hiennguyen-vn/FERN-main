package com.dorabets.common.config;

public final class RuntimeEnvironmentProbe {

    private RuntimeEnvironmentProbe() {
    }

    public static void main(String[] args) {
        RuntimeEnvironment.initialize(args);
        System.out.print(RuntimeEnvironment.isDevelopment());
    }
}
