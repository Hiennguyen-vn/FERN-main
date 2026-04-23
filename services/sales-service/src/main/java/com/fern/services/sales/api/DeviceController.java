package com.fern.services.sales.api;

import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.middleware.ServiceException;
import com.fern.services.sales.application.DeviceService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/devices")
public class DeviceController {

    private final DeviceService deviceService;
    private final AuthorizationPolicyService authorizationPolicyService;

    public DeviceController(DeviceService deviceService,
                            AuthorizationPolicyService authorizationPolicyService) {
        this.deviceService = deviceService;
        this.authorizationPolicyService = authorizationPolicyService;
    }

    @PostMapping("/provision")
    public ResponseEntity<DeviceDtos.ProvisionResponse> provision(
            @RequestBody DeviceDtos.ProvisionRequest request) {
        var ctx = RequestUserContextHolder.get();
        // Require manager or admin role
        if (!authorizationPolicyService.canWriteSales(ctx)) {
            throw ServiceException.forbidden("Manager role required to provision a device");
        }
        return ResponseEntity.ok(deviceService.provision(request));
    }
}
