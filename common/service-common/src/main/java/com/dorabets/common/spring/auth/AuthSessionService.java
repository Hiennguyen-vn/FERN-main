package com.dorabets.common.spring.auth;

import com.dorabets.common.middleware.ServiceException;
import com.natsu.common.utils.security.TokenUtil;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

@Service
public class AuthSessionService {

  private final AuthSessionRepository authSessionRepository;
  private final Clock clock;

  public AuthSessionService(AuthSessionRepository authSessionRepository, Clock clock) {
    this.authSessionRepository = authSessionRepository;
    this.clock = clock;
  }

  public AuthSessionRepository.AuthSessionRecord openSession(
      long userId,
      long ttlSeconds,
      String userAgent,
      String clientIp
  ) {
    Instant issuedAt = clock.instant();
    return authSessionRepository.createSession(new AuthSessionRepository.CreateSessionCommand(
        TokenUtil.generateRandomToken(24),
        userId,
        issuedAt,
        issuedAt.plusSeconds(ttlSeconds),
        null,
        normalizeUserAgent(userAgent),
        normalizeClientIp(clientIp)
    ));
  }

  public AuthSessionRepository.AuthSessionRecord refreshSession(
      String currentSessionId,
      long userId,
      long ttlSeconds,
      String userAgent,
      String clientIp
  ) {
    requireActiveSession(currentSessionId, userId);
    authSessionRepository.revokeSession(currentSessionId, userId, userId, "refresh");
    Instant refreshedAt = clock.instant();
    return authSessionRepository.createSession(new AuthSessionRepository.CreateSessionCommand(
        TokenUtil.generateRandomToken(24),
        userId,
        refreshedAt,
        refreshedAt.plusSeconds(ttlSeconds),
        refreshedAt,
        normalizeUserAgent(userAgent),
        normalizeClientIp(clientIp)
    ));
  }

  public AuthSessionRepository.AuthSessionRecord logoutSession(String sessionId, long userId) {
    return authSessionRepository.revokeSession(sessionId, userId, userId, "logout")
        .orElseThrow(() -> ServiceException.unauthorized("Session not found"));
  }

  public AuthSessionRepository.AuthSessionRecord revokeSession(
      String sessionId,
      long userId,
      Long actorUserId,
      String reason
  ) {
    return authSessionRepository.revokeSession(sessionId, userId, actorUserId, reason)
        .orElseThrow(() -> ServiceException.notFound("Session not found: " + sessionId));
  }

  public int revokeOtherSessions(long userId, String keepSessionId, Long actorUserId) {
    return authSessionRepository.revokeOtherSessions(userId, keepSessionId, actorUserId, "user_revoke");
  }

  public List<AuthSessionRepository.AuthSessionRecord> listSessions(long userId) {
    return authSessionRepository.listSessionsForUser(userId);
  }

  public Optional<AuthSessionRepository.AuthSessionRecord> findSession(String sessionId) {
    return authSessionRepository.findBySessionId(sessionId);
  }

  public AuthSessionRepository.AuthSessionRecord getRequiredSession(String sessionId, long userId) {
    return authSessionRepository.findBySessionId(sessionId)
        .filter(session -> session.userId() == userId)
        .orElseThrow(() -> ServiceException.unauthorized("Authentication session is missing"));
  }

  public void requireActiveSession(String sessionId, Long userId) {
    if (sessionId == null || sessionId.isBlank() || userId == null) {
      throw ServiceException.unauthorized("Authentication session is missing");
    }
    boolean active = authSessionRepository.isSessionActive(sessionId, userId, clock.instant());
    if (!active) {
      throw ServiceException.unauthorized("Authentication session is no longer active");
    }
  }

  private static String normalizeUserAgent(String userAgent) {
    if (userAgent == null) {
      return null;
    }
    String trimmed = userAgent.trim();
    if (trimmed.isEmpty()) {
      return null;
    }
    return trimmed.length() <= 512 ? trimmed : trimmed.substring(0, 512);
  }

  private static String normalizeClientIp(String clientIp) {
    if (clientIp == null) {
      return null;
    }
    String trimmed = clientIp.trim();
    if (trimmed.isEmpty()) {
      return null;
    }
    return trimmed.length() <= 128 ? trimmed : trimmed.substring(0, 128);
  }
}
