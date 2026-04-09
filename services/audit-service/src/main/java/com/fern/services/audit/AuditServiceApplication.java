package com.fern.services.audit;

import com.dorabets.common.config.RuntimeEnvironment;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = {"com.fern.services.audit", "com.dorabets.common.spring"})
@EnableKafka
@EnableScheduling
public class AuditServiceApplication {

  public static void main(String[] args) {
    RuntimeEnvironment.initialize(args);
    SpringApplication.run(AuditServiceApplication.class, args);
  }
}
