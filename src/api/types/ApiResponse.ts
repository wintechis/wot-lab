export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  details?: string;
  timestamp: string;
}

export class ApiResponseBuilder {
  static success<T>(data: T, message?: string): ApiResponse<T> {
    return {
      success: true,
      data,
      message,
      timestamp: new Date().toISOString()
    };
  }

  static error(message: string, error?: unknown, details?: string): ApiResponse {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: message,
      details: details || errorMessage,
      timestamp: new Date().toISOString()
    };
  }

  static notFound(resource: string, id?: string): ApiResponse {
    const message = id ? `${resource} '${id}' not found` : `${resource} not found`;
    return {
      success: false,
      error: message,
      timestamp: new Date().toISOString()
    };
  }
}
