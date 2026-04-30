import { isApiError } from '@/api/client';

export const PRODUCT_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_TOO_LARGE_MESSAGE = 'Ảnh vượt quá 5MB. Vui lòng nén ảnh hoặc chọn ảnh nhỏ hơn.';

const PRODUCT_IMAGE_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function getApiErrorCode(error: unknown): string | null {
  if (!isApiError(error) || !error.details || typeof error.details !== 'object' || Array.isArray(error.details)) {
    return null;
  }
  const details = error.details as Record<string, unknown>;
  return typeof details.error === 'string' ? details.error : null;
}

export function validateProductImageFile(file: File): string | null {
  if (!PRODUCT_IMAGE_ALLOWED_TYPES.has(file.type)) {
    return 'Định dạng ảnh không hỗ trợ. Vui lòng dùng JPG, PNG hoặc WEBP.';
  }
  if (file.size <= 0) {
    return 'Ảnh không có dữ liệu. Vui lòng chọn ảnh khác.';
  }
  if (file.size > PRODUCT_IMAGE_MAX_SIZE_BYTES) {
    return PRODUCT_IMAGE_TOO_LARGE_MESSAGE;
  }
  return null;
}

export function getProductImageUploadErrorMessage(error: unknown, fallback = 'Tải ảnh thất bại'): string {
  const apiErrorCode = getApiErrorCode(error);
  const message = isApiError(error)
    ? error.message
    : error instanceof Error
      ? error.message
      : '';

  if (
    (isApiError(error) && error.status === 413)
    || apiErrorCode === 'payload_too_large'
    || /maximum upload size|maximum permitted size|file exceeds/i.test(message)
  ) {
    return PRODUCT_IMAGE_TOO_LARGE_MESSAGE;
  }

  return message || fallback;
}
