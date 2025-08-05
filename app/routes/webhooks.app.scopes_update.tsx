import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("🔄 Scopes update webhook received");
  
  try {
    // ✅ Use authenticate.webhook for proper HMAC validation
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    
    console.log(`🔄 Processing ${topic} for ${shop}`);

    const current = payload.current as string[];
    
    if (session) {
      await db.session.update({   
        where: {
          id: session.id
        },
        data: {
          scope: current.toString(),
        },
      });
      
      console.log(`✅ Updated scopes for ${shop}: ${current.join(', ')}`);
    }
    
    console.log("✅ Scopes update webhook processed successfully");
    return new Response(null, { status: 200 });
    
  } catch (error: any) {
    console.error("❌ Scopes update webhook error:", error.message);
    
    // Check for HMAC validation errors
    if (
      error.message?.toLowerCase().includes('unauthorized') ||
      error.message?.toLowerCase().includes('hmac') ||
      error.status === 401
    ) {
      console.log("🚨 HMAC validation failed - returning 401");
      return new Response("Unauthorized", { status: 401 });
    }
    
    // For other errors, return 500
    return new Response("Internal Server Error", { status: 500 });
  }
};