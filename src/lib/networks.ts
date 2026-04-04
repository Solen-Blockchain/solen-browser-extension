export type NetworkId = "mainnet" | "testnet" | "devnet";

export interface NetworkConfig {
  id: NetworkId;
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  color: string;
}

export const networks: Record<NetworkId, NetworkConfig> = {
  mainnet: {
    id: "mainnet",
    name: "Mainnet",
    chainId: 1,
    rpcUrl: "https://rpc.solenchain.io",
    explorerUrl: "https://solenscan.io",
    color: "#10b981",
  },
  testnet: {
    id: "testnet",
    name: "Testnet",
    chainId: 9000,
    rpcUrl: "https://testnet-rpc.solenchain.io",
    explorerUrl: "https://solenscan.io",
    color: "#f59e0b",
  },
  devnet: {
    id: "devnet",
    name: "Devnet",
    chainId: 1337,
    rpcUrl: "http://127.0.0.1:29944",
    explorerUrl: "http://127.0.0.1:29955",
    color: "#6366f1",
  },
};

export const DEFAULT_NETWORK: NetworkId = "testnet";
