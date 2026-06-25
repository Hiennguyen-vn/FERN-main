package com.fern.services.sync.application;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableConfigurationProperties(SyncProperties.class)
public class SyncConfiguration {
}
