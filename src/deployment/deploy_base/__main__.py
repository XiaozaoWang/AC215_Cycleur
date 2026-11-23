import os

import pulumi
import pulumi_gcp as gcp

# The pieces that outlive the cluster. They live in their own stack, so the cluster can be destroyed
# and recreated without the address changing.
project = pulumi.Config("gcp").require("project")
region = os.environ["GCP_REGION"]
app_name = "greenpath"

# The Gateway's IP. Global, because the gke-l7-global-external-managed load balancer is; the Gateway
# asks for it by name (k8s/gke/gateway.yaml: spec.addresses, NamedAddress greenpath-gateway-ip).
gateway_ip = gcp.compute.GlobalAddress(
    f"{app_name}-gateway-ip",
    name=f"{app_name}-gateway-ip",
    description="GreenPath GKE Gateway",
    labels={"app": app_name},
)

# Export values
pulumi.export("gateway_ip", gateway_ip.address)
pulumi.export("gateway_ip_name", gateway_ip.name)
# Where the images go: the Artifact Registry repository Cloud Run already uses (it exists, so not created here)
pulumi.export("registry", f"{region}-docker.pkg.dev/{project}/greenpath")
