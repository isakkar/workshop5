import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";
import {delay} from "@/src/utils";

type Message = {
  p: 1 | 2
  k: number
  x: Value | null
  nodeId: number
}

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

  let messages: Record<number, Record<number, Message[]>>; // the messages received each round from other nodes
  let currentValue: Value | null = initialValue; // current value of the node
  let currentRound: number = 1; // current round
  let currentPhase: 1 | 2 = 1 // current phase (1 or 2)
  let decided: boolean = false; // if the node reached finality

  function storeMessage(message: Message): void {
    const { k, p } = message
    if(!messages[k]) messages[k] = {[1]: [], [2]: []} // if dict for round k doesn't exist, create it
    // Check if the node ID is not already in the array before adding the message
    const nodeIdExists = messages[k][p].some(msg => msg.nodeId === message.nodeId);
    if (!nodeIdExists) {
      messages[k][p].push(message);
    }
  }

  function getMessages(k: number, phase: 1 | 2): Message[] {
    return messages[k][phase]
  }

  function getMessagesLen(k: number, phase: 1 | 2): number {
    return messages[k][phase].length
  }

  function getValue(m:Message): Value | null {
    return m.x
  }

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
    const { p, k } = req.body;
    if(currentRound == k && currentPhase == p) { // if same phase & round
      storeMessage(req.body); // add message
      res.status(200).send("received"); // respond

      if(getMessagesLen(currentRound,currentPhase) >= N-F){ // if node got enough messages this phase and round
        let n = getMessagesLen(currentRound,currentPhase);

        if(currentPhase === 1){
          let phaseMessages: Message[] = getMessages(currentRound,currentPhase) // get the relevant messages
          let count: Record<Value, number> = {0:0, 1:0, "?":0}; // count the number of each value
          for(let i = 0; i < n; i++){
            let v = getValue(phaseMessages[i]);
            if(v != null) {
              count[v] += 1;
            }
          }

          // if there is a majority, set node's value to it
          if(count[0] >= N/2){
            currentValue = 0;
          } else if(count[1] >= N/2){
            currentValue = 1;
          } else {   // otherwise, set it to unknown
            currentValue = "?";
          }

          // send phase 2 message to other nodes
          currentPhase = 2; // change phase
          for(let i=0; i<N; i++){
            if(i !== nodeId){
              fetch(`http://localhost:${BASE_NODE_PORT+i}/message`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({p:currentPhase, k:currentRound, x:currentValue, nodeId:nodeId})
              });
            }
          }

        } else if(currentPhase === 2){
          let phaseMessages: Message[] = getMessages(currentRound,currentPhase) // get the relevant messages
          let count: Record<Value, number> = {0:0, 1:0, "?":0}; // count the number of each value
          for(let i = 0; i < n; i++){
            let v = getValue(phaseMessages[i]);
            if(v != null) {
              count[v] += 1;
            }
          }
          if(count[0] > 2*F){          // if enough messages have same value, DECIDE on it
            currentValue = 0;
            decided = true;
          } else if(count[1] > 2*F){
            currentValue = 1;
            decided = true;
          } else if(count[0] > F+1) {  // otherwise, if enough (less) messages have same value, set node's value to it
            currentValue = 0;
          } else if(count[1] > F+1) {
            currentValue = 1;
          } else {                     // set node's value to a random value
            currentValue = Math.round(Math.random()) as Value;
          }
          currentRound += 1;
          currentPhase = 1;
        } else {
          console.log("Error: phase number");
        }
      }
    } else {
      res.send("wrong phase");
    }
  });

  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while(!nodesAreReady()){
      await delay(100);
    }
    for(let i=0; i<N; i++){
      if(i !== nodeId){
        fetch(`http://localhost:${BASE_NODE_PORT+i}/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({p:currentPhase, k:currentRound, x:currentValue, nodeId:nodeId})
        });
      }
    }
  });

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
