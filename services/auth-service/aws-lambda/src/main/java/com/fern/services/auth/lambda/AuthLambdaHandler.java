package com.fern.services.auth.lambda;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import java.util.Map;

public class AuthLambdaHandler implements
    RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent> {

  @Override
  public APIGatewayProxyResponseEvent handleRequest(
      APIGatewayProxyRequestEvent input,
      Context context
  ) {
    String body = """
        {"service":"auth-service","runtime":"aws-lambda","status":"BOOTSTRAP_READY"}
        """.trim();
    return new APIGatewayProxyResponseEvent()
        .withStatusCode(200)
        .withHeaders(Map.of("Content-Type", "application/json"))
        .withBody(body);
  }
}
