package com.natsu.common.utils.usage;

import com.natsu.common.utils.services.ServiceCategory;
import com.natsu.common.utils.services.ServiceDefinition;
import com.natsu.common.utils.services.ServicesRegistry;

import java.util.HashMap;
import java.util.Map;

/**
 * Usage example for {@link ServicesRegistry}.
 * Demonstrates:
 * 1. Configuration Registry (Legacy/Config mode)
 * 2. Service Locator (Instance mode)
 */
public final class ServicesRegistryUsage {

    public static void main(String[] args) {
        System.out.println("=== ServicesRegistry Usage Example ===");

        // 1. Configuration Registry Usage
        demonstrateConfigRegistry();

        // 2. Service Locator Usage
        demonstrateServiceLocator();

        System.out.println("\n=== Done ===");
    }

    private static void demonstrateConfigRegistry() {
        System.out.println("\n--- Configuration Registry ---");

        // Define a custom config
        ServiceDefinition myConfig = new ServiceDefinition() {
            @Override
            public String getName() {
                return "my-custom-config";
            }

            @Override
            public ServiceCategory getServiceCategory() {
                return ServiceCategory.DATABASE;
            } // Using an existing category for demo

            @Override
            public void validate() {
                System.out.println("Validating config...");
            }

            @Override
            public Map<String, Object> toMap() {
                return new HashMap<>();
            }

            @Override
            public String getDescription() {
                return "A demo config";
            }
        };

        // Register
        System.out.println("Registering config: " + myConfig.getName());
        ServicesRegistry.registerConfig(myConfig);

        // Retrieve
        ServiceDefinition retrieved = ServicesRegistry.getConfig("my-custom-config", ServiceCategory.DATABASE);
        System.out.println("Retrieved config: " + retrieved.getName());

        // Check existence
        boolean exists = ServicesRegistry.containsConfig("my-custom-config", ServiceCategory.DATABASE);
        System.out.println("Config exists: " + exists);
    }

    private static void demonstrateServiceLocator() {
        System.out.println("\n--- Service Locator ---");

        // Define a service interface and implementation
        MyService serviceInstance = new MyServiceImpl();

        // Register service instance
        System.out.println("Registering service: " + MyService.class.getSimpleName());
        ServicesRegistry.register(MyService.class, serviceInstance);

        // Retrieve service
        MyService retrieved = ServicesRegistry.getService(MyService.class);
        retrieved.doSomething();

        // Unregister
        ServicesRegistry.unregister(MyService.class);
        System.out.println("Unregistered service.");
    }

    interface MyService {
        void doSomething();
    }

    static class MyServiceImpl implements MyService {
        @Override
        public void doSomething() {
            System.out.println("MyService is doing something!");
        }
    }
}
