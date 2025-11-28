import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedMysticAPR = await deploy("MysticAPR", {
    from: deployer,
    log: true,
  });

  console.log(`MysticAPR contract: `, deployedMysticAPR.address);
};
export default func;
func.id = "deploy_mysticAPR"; // id required to prevent reexecution
func.tags = ["MysticAPR"];
