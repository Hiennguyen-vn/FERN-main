package com.fern.services.product;

import com.dorabets.common.config.RuntimeEnvironment;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(scanBasePackages = {"com.fern.services.product", "com.dorabets.common.spring"})
@EnableScheduling
public class ProductServiceApplication {

  public static void main(String[] args) {
    RuntimeEnvironment.initialize(args);
    SpringApplication.run(ProductServiceApplication.class, args);
  }
}
