import pulumi_gcp as gcp
from pulumi import ResourceOptions

machine_disk_size = 50

# Two node pools of fixed size (no autoscaling, so the bill is known):
#   web:    the frontend, the API, RAG and Chroma
#   model:  one model-service pod per node (k8s/base/model-service.yaml asks for 3 of the 4 CPUs).
#           Tainted, so only pods that tolerate pool=model run there and the 4 model pods always find room.
NODE_POOLS = [
    dict(name="web", nodes=3, machine="e2-standard-2", taint=False),
    dict(name="model", nodes=4, machine="e2-standard-4", taint=True),
]

# Workload Identity: each Kubernetes ServiceAccount (in namespace greenpath, k8s/base/) acts as the Google
# service account its Cloud Run service already uses, so the pods reach Vertex AI and Cloud Storage with no key file
ksa_namespace = "greenpath"
WORKLOAD_IDENTITY = {
    "api-service": "greenpath-api-service",  # Gemini, and the bucket
    "model-service": "greenpath-model-service",  # the aerial tiles in the bucket
    "rag-service": "greenpath-rag-service",  # Gemini, for RAG answers
    "vector-db": "greenpath-rag-service",  # the knowledge archive in the RAG bucket
}


def create_cluster(project, zone, network, subnet, app_name):
    # Create a zonal GKE cluster (one control plane, covered by GKE's free tier) with private nodes,
    # Workload Identity (for Vertex AI and Cloud Storage without key files), the Gateway API, and no
    # default node pool. The nodes run as the project's default Compute Engine service account.
    cluster = gcp.container.Cluster(
        f"{app_name}-cluster",
        name=f"{app_name}-cluster",
        description="GreenPath GKE cluster",
        location=zone,
        deletion_protection=False,
        network=network.name,
        subnetwork=subnet.name,
        networking_mode="VPC_NATIVE",
        ip_allocation_policy={},  # let GKE create the pod and service ranges
        remove_default_node_pool=True,  # Remove default pool to use the node pools below
        initial_node_count=1,
        release_channel={"channel": "REGULAR"},
        private_cluster_config={
            "enable_private_nodes": True,  # Nodes use private IPs only
            "enable_private_endpoint": False,  # Control plane reachable from the deployment shell
            "master_ipv4_cidr_block": "172.16.0.0/28",  # CIDR for GKE control plane
        },
        workload_identity_config={"workload_pool": f"{project}.svc.id.goog"},
        gateway_api_config={"channel": "CHANNEL_STANDARD"},  # GatewayClasses for the Gateway/HTTPRoute
        resource_labels={"app": app_name},
    )

    # Create the node pools: fixed size, auto-repair, standard GCP service permissions
    node_pools = []
    for pool in NODE_POOLS:
        node_pools.append(
            gcp.container.NodePool(
                f"{app_name}-{pool['name']}-pool",
                name=f"{app_name}-{pool['name']}-pool",
                cluster=cluster.name,
                location=zone,
                node_count=pool["nodes"],
                node_config=gcp.container.NodePoolNodeConfigArgs(
                    machine_type=pool["machine"],
                    image_type="cos_containerd",  # Container-Optimized OS with containerd runtime
                    disk_size_gb=machine_disk_size,
                    workload_metadata_config={"mode": "GKE_METADATA"},  # Workload Identity on these nodes
                    oauth_scopes=["https://www.googleapis.com/auth/cloud-platform"],  # IAM decides, not scopes
                    labels={"app": app_name, "pool": pool["name"]},  # pods pick a pool by this label
                    taints=[{"key": "pool", "value": "model", "effect": "NO_SCHEDULE"}] if pool["taint"] else None,
                ),
                management=gcp.container.NodePoolManagementArgs(auto_repair=True, auto_upgrade=True),
                opts=ResourceOptions(depends_on=[cluster]),
            )
        )

    # Workload Identity: pods running as each Kubernetes ServiceAccount act as its Google service account
    for ksa_name, gsa_name in WORKLOAD_IDENTITY.items():
        gcp.serviceaccount.IAMMember(
            f"{app_name}-workload-identity-{ksa_name}",
            service_account_id=f"projects/{project}/serviceAccounts/{gsa_name}@{project}.iam.gserviceaccount.com",
            role="roles/iam.workloadIdentityUser",
            member=f"serviceAccount:{project}.svc.id.goog[{ksa_namespace}/{ksa_name}]",
            opts=ResourceOptions(depends_on=[cluster]),  # the identity pool exists once the cluster does
        )

    return cluster, node_pools
