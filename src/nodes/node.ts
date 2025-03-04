import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let messages: {[round: number]: Value[]}; // the messages received each round from other nodes
  let currentValue: Value = initialValue; // current value of the node
  let currentRound: number = 1; // current round
  let decided: boolean = false; // if the node reached finality

  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if(isFaulty){
      res.status(500).send('faulty');
    } else {
      res.status(200).send('live');
    }
  });

  // this route allows the node to receive messages from other nodes
  node.post("/message", (req, res) => {
    const { k, v } = req.body; // receive round and value
    if(!messages[k]){ // if list of messages received doesn't exist yet, create it
      messages[k] = [];
    }
    messages[k].push(v); // add value to the list
    res.status(200).send("received"); // respond
  });

  // TODO implement this
  // this route is used to start the consensus algorithm
  // node.get("/start", async (req, res) => {});

  // TODO implement this
  // this route is used to stop the consensus algorithm
  // node.get("/stop", async (req, res) => {});

  // get the current state of a node
  node.get("/getState", (req, res) => {
    var state: NodeState;
    if(isFaulty) {
      state = {killed: false, x: null, decided: null, k: null};
    } else {
      state = {killed: false, x: currentValue, decided: decided, k: currentRound};
    }
    res.json(state);
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
