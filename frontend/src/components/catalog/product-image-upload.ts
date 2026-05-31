import { isApiError } from '@/api/client';

export const PRODUCT_IMAGE_MAX_SIZE_BYTES = 50 * 1024 * 1024;
export const PRODUCT_IMAGE_TOO_LARGE_MESSAGE = 'Ảnh vượt quá giới hạn tải lên. Vui lòng chọn ảnh nhỏ hơn.';

const PRODUCT_IMAGE_ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PRODUCT_IMAGE_OUTPUT_QUALITIES = [0.9, 0.82, 0.72, 0.62, 0.52, 0.42, 0.32, 0.24, 0.18];
const PRODUCT_IMAGE_MAX_DIMENSIONS = [2560, 2048, 1600, 1280, 1024, 768, 512];

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
  return null;
}

function getCompressedImageName(fileName: string, type: string): string {
  const extension = type === 'image/webp' ? 'webp' : 'jpg';
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'product-image';
  return `${baseName}.${extension}`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof URL === 'undefined' || typeof Image === 'undefined') {
      reject(new Error(PRODUCT_IMAGE_TOO_LARGE_MESSAGE));
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Không đọc được ảnh. Vui lòng chọn ảnh khác.'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function renderImageToCanvas(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  outputType: string,
) {
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (outputType === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
}

async function compressProductImageFile(file: File): Promise<File> {
  if (typeof document === 'undefined') {
    throw new Error(PRODUCT_IMAGE_TOO_LARGE_MESSAGE);
  }

  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('Không đọc được kích thước ảnh. Vui lòng chọn ảnh khác.');
  }

  const outputTypes = file.type === 'image/png'
    ? ['image/webp', 'image/jpeg']
    : ['image/webp', 'image/jpeg'];

  for (const maxDimension of PRODUCT_IMAGE_MAX_DIMENSIONS) {
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error(PRODUCT_IMAGE_TOO_LARGE_MESSAGE);
    }

    for (const outputType of outputTypes) {
      renderImageToCanvas(context, image, width, height, outputType);
      for (const quality of PRODUCT_IMAGE_OUTPUT_QUALITIES) {
        const blob = await canvasToBlob(canvas, outputType, quality);
        if (!blob) continue;
        if (blob.size > 0 && blob.size <= PRODUCT_IMAGE_MAX_SIZE_BYTES) {
          return new File([blob], getCompressedImageName(file.name, blob.type || outputType), {
            type: blob.type || outputType,
            lastModified: Date.now(),
          });
        }
      }
    }
  }

  throw new Error(PRODUCT_IMAGE_TOO_LARGE_MESSAGE);
}

export async function prepareProductImageFile(
  file: File,
  compressor: (file: File) => Promise<File> = compressProductImageFile,
): Promise<File> {
  const validationError = validateProductImageFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  if (file.size <= PRODUCT_IMAGE_MAX_SIZE_BYTES) {
    return file;
  }

  const compressedFile = await compressor(file);
  const compressedValidationError = validateProductImageFile(compressedFile);
  if (compressedValidationError || compressedFile.size > PRODUCT_IMAGE_MAX_SIZE_BYTES) {
    throw new Error(compressedValidationError || PRODUCT_IMAGE_TOO_LARGE_MESSAGE);
  }

  return compressedFile;
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
