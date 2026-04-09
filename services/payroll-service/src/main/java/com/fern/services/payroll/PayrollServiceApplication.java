package com.fern.services.payroll;

import com.dorabets.common.config.RuntimeEnvironment;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.kafka.annotation.EnableKafka;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = {"com.fern.services.payroll", "com.dorabets.common.spring"})
@EnableKafka
@EnableScheduling
public class PayrollServiceApplication {

  public static void main(String[] args) {
    RuntimeEnvironment.initialize(args);
    SpringApplication.run(PayrollServiceApplication.class, args);
  }
}
