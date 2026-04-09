package com.fern.services.auth.spring;

import com.dorabets.common.config.RuntimeEnvironment;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = {"com.fern.services.auth.spring", "com.dorabets.common.spring"})
@EnableScheduling
public class AuthServiceApplication {

  public static void main(String[] args) {
    RuntimeEnvironment.initialize(args);
    SpringApplication.run(AuthServiceApplication.class, args);
  }
}
