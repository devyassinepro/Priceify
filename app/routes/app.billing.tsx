
import { LoaderFunctionArgs, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app/plans");
};

export default function Billing() {
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h1>Redirecting to plans...</h1>
    </div>
  );
}