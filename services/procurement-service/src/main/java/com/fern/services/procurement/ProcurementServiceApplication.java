package com.fern.services.procurement;

import com.fern.common.config.RuntimeEnvironment;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = {"com.fern.services.procurement", "com.fern.common.spring"})
@EnableScheduling
public class ProcurementServiceApplication {

  public static void main(String[] args) {
    RuntimeEnvironment.initialize(args);
    SpringApplication.run(ProcurementServiceApplication.class, args);
  }
}
