import { db } from "../db.server";

export interface ErrorLog {
  shop: string;
  errorType: string;
  message: string;
  context?: Record<string, any>;
  timestamp: Date;
}

export async function logError(errorLog: ErrorLog): Promise<void> {
  try {
    console.error(`[${errorLog.errorType}] ${errorLog.message}`, errorLog.context);
    
    // In production, you might want to send to monitoring service
    if (process.env.NODE_ENV === "production") {
      // Example: Send to Sentry, Bugsnag, etc.
      // await sendToMonitoringService(errorLog);
    }
  } catch (e) {
    console.error("Error during logging:", e);
  }
}

export function handleGraphQLErrors(errors: any[], shop: string): string[] {
  const messages: string[] = [];
  
  for (const error of errors) {
    let userMessage = "An unexpected error occurred";
    
    // Shopify-specific error messages
    if (error.message.includes("price")) {
      userMessage = "Price error: Please verify that all prices are valid";
    } else if (error.message.includes("access") || error.message.includes("permission")) {
      userMessage = "Insufficient permissions for this action";
    } else if (error.message.includes("not found")) {
      userMessage = "Product or variant not found";
    } else if (error.message.includes("rate") || error.message.includes("throttle")) {
      userMessage = "Too many requests, please wait and try again";
    } else if (error.message.includes("variant") && error.message.includes("bulk")) {
      userMessage = "Error updating product variants. Some variants may not have been updated.";
    } else if (error.message.includes("inventory")) {
      userMessage = "Inventory tracking error. Price may have been updated but inventory wasn't synced.";
    } else if (error.message.includes("currency")) {
      userMessage = "Currency format error. Please check your price formatting.";
    }
    
    messages.push(userMessage);
    
    // Log technical error details
    logError({
      shop,
      errorType: "GRAPHQL_ERROR",
      message: error.message,
      context: { error, extensions: error.extensions },
      timestamp: new Date(),
    });
  }
  
  return messages;
}

export function createUserFriendlyError(error: any, context: string): string {
  // Network errors
  if (error.message.includes("ENOTFOUND") || error.message.includes("network")) {
    return "Network connection problem. Please check your internet connection and try again.";
  }
  
  // Timeout errors
  if (error.message.includes("timeout")) {
    return "Request timed out. Please try again in a moment.";
  }
  
  // Database errors (Prisma)
  if (error.message.includes("P2002")) {
    return "This data already exists in the system";
  }
  
  if (error.message.includes("P2025")) {
    return "Record not found";
  }
  
  if (error.message.includes("P2003")) {
    return "Cannot delete this item because it's referenced by other data";
  }
  
  // Shopify API errors
  if (error.message.includes("429")) {
    return "API rate limit exceeded. Please wait a moment and try again.";
  }
  
  if (error.message.includes("401") || error.message.includes("unauthorized")) {
    return "Authentication failed. Please reconnect your app.";
  }
  
  if (error.message.includes("403") || error.message.includes("forbidden")) {
    return "Permission denied. Please check your app permissions.";
  }
  
  if (error.message.includes("404")) {
    return "The requested resource was not found";
  }
  
  if (error.message.includes("500")) {
    return "Server error occurred. Please try again later.";
  }
  
  // Validation errors
  if (error.message.includes("validation")) {
    return "Data validation failed. Please check your input values.";
  }
  
  // Generic error with context
  return `Error during ${context}. Please try again or contact support if the problem persists.`;
}

export function getErrorSeverity(error: any): 'low' | 'medium' | 'high' | 'critical' {
  const message = error.message.toLowerCase();
  
  // Critical errors that break core functionality
  if (message.includes("database") || 
      message.includes("authentication") || 
      message.includes("authorization") ||
      message.includes("payment")) {
    return 'critical';
  }
  
  // High severity - affects user experience significantly
  if (message.includes("graphql") || 
      message.includes("api") || 
      message.includes("network") ||
      message.includes("timeout")) {
    return 'high';
  }
  
  // Medium severity - partial functionality affected
  if (message.includes("validation") || 
      message.includes("format") || 
      message.includes("parse")) {
    return 'medium';
  }
  
  // Low severity - minor issues
  return 'low';
}

export async function handleCriticalError(
  error: any, 
  shop: string, 
  context: string
): Promise<void> {
  const severity = getErrorSeverity(error);
  
  await logError({
    shop,
    errorType: `CRITICAL_${context.toUpperCase()}`,
    message: error.message,
    context: { 
      stack: error.stack, 
      severity,
      timestamp: new Date().toISOString(),
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'server'
    },
    timestamp: new Date(),
  });
  
  // For critical errors, you might want to:
  // 1. Send immediate alerts to your team
  // 2. Automatically create support tickets
  // 3. Log to external monitoring services
  
  if (process.env.NODE_ENV === "production" && severity === 'critical') {
    // Example: Send to alerting system
    // await sendCriticalAlert(error, shop, context);
  }
}

export function formatErrorForUser(
  error: any, 
  fallbackMessage: string = "Something went wrong"
): string {
  // Don't expose sensitive error details to users
  const userMessage = createUserFriendlyError(error, "this operation");
  
  // Add helpful suggestions based on error type
  if (error.message.includes("network")) {
    return `${userMessage} You might want to check your internet connection.`;
  }
  
  if (error.message.includes("rate")) {
    return `${userMessage} Try again in a few minutes.`;
  }
  
  if (error.message.includes("permission")) {
    return `${userMessage} Please contact your store administrator.`;
  }
  
  return userMessage || fallbackMessage;
}

// Error boundary helper for React components
export class AppError extends Error {
  public severity: 'low' | 'medium' | 'high' | 'critical';
  public context: Record<string, any>;
  public userMessage: string;
  
  constructor(
    message: string, 
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
    context: Record<string, any> = {},
    userMessage?: string
  ) {
    super(message);
    this.name = 'AppError';
    this.severity = severity;
    this.context = context;
    this.userMessage = userMessage || createUserFriendlyError(this, "application");
  }
}