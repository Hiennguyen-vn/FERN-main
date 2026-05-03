package com.fern.services.sales.api;

import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.common.middleware.ServiceException;
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
        if (!authorizationPolicyService.canWriteSalesForOutlet(ctx, request.outletId())) {
            throw ServiceException.forbidden(
                    "Device provisioning denied: no write-sales access for outlet " + request.outletId());
        }
        return ResponseEntity.ok(deviceService.provision(request));
    }
}
