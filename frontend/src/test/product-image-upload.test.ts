import { describe, expect, it } from 'vitest';
import { ApiError } from '@/api/client';
import {
  getProductImageUploadErrorMessage,
  PRODUCT_IMAGE_MAX_SIZE_BYTES,
  PRODUCT_IMAGE_TOO_LARGE_MESSAGE,
  validateProductImageFile,
} from '@/components/catalog/product-image-upload';

describe('catalog product image upload helpers', () => {
  it('accepts supported image files within the 5MB business limit', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'product.png', { type: 'image/png' });

    expect(validateProductImageFile(file)).toBeNull();
  });

  it('rejects unsupported image files before upload', () => {
    const file = new File([new Uint8Array([1])], 'product.txt', { type: 'text/plain' });

    expect(validateProductImageFile(file)).toContain('Định dạng ảnh không hỗ trợ');
  });

  it('rejects files above 5MB before upload', () => {
    const file = new File([new Uint8Array(PRODUCT_IMAGE_MAX_SIZE_BYTES + 1)], 'large.png', { type: 'image/png' });

    expect(validateProductImageFile(file)).toBe(PRODUCT_IMAGE_TOO_LARGE_MESSAGE);
  });

  it('maps backend 413 upload errors to the catalog image message', () => {
    const error = new ApiError(
      'Uploaded file exceeds the maximum permitted size',
      413,
      { error: 'payload_too_large' },
    );

    expect(getProductImageUploadErrorMessage(error)).toBe(PRODUCT_IMAGE_TOO_LARGE_MESSAGE);
  });

  it('preserves non-size upload errors', () => {
    const error = new ApiError('Image upload is not configured for this environment', 400, { error: 'bad_request' });

    expect(getProductImageUploadErrorMessage(error)).toBe('Image upload is not configured for this environment');
  });
});
