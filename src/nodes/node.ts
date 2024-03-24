import express from "express";
import {BASE_NODE_PORT} from "../config";
import {NodeState, Value} from "../types";
import {delay} from "../utils";
import http from 'http';

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void) 
{
  // Initialize express app
  const app = express();
  app.use(express.json());

  // Initialize the state of the node
  let currentState: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  // Initialize proposals and votes
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // Endpoint to get the status of the node
  app.get("/status", (req, res) => {
    res.status(isFaulty ? 500 : 200).send(isFaulty ? 'faulty' : 'live');
  });

  // Endpoint to start the consensus algorithm
  app.get('/start', async (req, res) => {
    // Wait until all nodes are ready
    while (!nodesAreReady()) await delay(5);
    // If the node is not faulty, send a proposal to all nodes
    if (!isFaulty) {
      if (currentState.k !== null && currentState.x !== null) {
        for (let i = 0; i < N; i++) {
          sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, { k: currentState.k, x: currentState.x, messageType: 'propose' });
        }
      }
    }
    res.status(200).send('Consensus algorithm started.');
  });

  // Endpoint to stop the consensus algorithm
  app.get("/stop", async (req, res) => {
    currentState.killed = true;
    res.status(200).send("Node stopped.");
  });

  // Endpoint to get the current state of a node
  app.get("/getState", (req, res) => {
    res.status(200).send({
      killed: currentState.killed,
      x: currentState.x,
      decided: currentState.decided,
      k: currentState.k,
    });
  });

  // Endpoint to receive messages
  app.post('/message', async (req, res) => {
    if (isFaulty || currentState.killed) {
      res.status(200).send('Message received but ignored.');
      return;
    }

    const { k, x, messageType } = req.body;
    if (messageType === 'propose') {
      processProposal(k, x);
    } else if (messageType === 'vote') {
      processVote(k, x);
    }

    res.status(200).send('Message received and processed.');
  });

  // Function to process a proposal
  function processProposal(k: number, x: Value) {
    updateProposalMap(proposals, k, x);
    const proposalValues = proposals.get(k);
    if (proposalValues && proposalValues.length >= N - F) {
      makeDecisionAndBroadcast(k, proposalValues);
    }
  }

  // Function to process a vote
  function processVote(k: number, x: Value) {
    updateProposalMap(votes, k, x);
    const voteValues = votes.get(k);
    if (voteValues && voteValues.length >= N - F) {
      makeFinalDecision(k, voteValues);
    }
  }

  // Function to update the proposal map
  function updateProposalMap(map: Map<number, Value[]>, k: number, x: Value) {
    const values = map.get(k) || [];
    values.push(x);
    map.set(k, values); 
  }

  // Function to make a decision and broadcast it
  function makeDecisionAndBroadcast(k: number, proposal: Value[]) {
    let count = countVotes(proposal);
    let decision: Value = count[0] > N / 2 ? 0 : count[1] > N / 2 ? 1 : Math.random() > 0.5 ? 0 : 1; // Ensure decision is of type Value
    sendBroadcastMessage(k, decision, 'vote');
  }

  // Function to make a final decision
  function makeFinalDecision(k: number, vote: Value[]) {
    let count = countVotes(vote);
    if (count[0] >= F + 1 || count[1] >= F + 1) {
      currentState.x = count[0] > count[1] ? 0 : 1;
      currentState.decided = true;
    } else {
      currentState.k = k + 1;
      currentState.x = Math.random() > 0.5 ? 0 : 1;
      sendBroadcastMessage(currentState.k, currentState.x, 'propose');
    }
  }

  // Function to send a broadcast message
  function sendBroadcastMessage(k: number, x: Value, messageType: string) {
    for (let i = 0; i < N; i++) {
      sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, { k, x, messageType });
    }
  }

  // Function to count votes
  function countVotes(array: Value[]): number[] {
    let counts = [0, 0]; 
    array.forEach((value) => {
      if (value !== '?') {
        counts[value]++;
      }
    });
    return counts;
  }


  // Function to send a message to a specific URL
  function sendMessage(url: string, body: any) {
    http.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.on('data', () => {});
      }
    )
    .on('error', (error) => {
      console.error(error);
    })
    .end(JSON.stringify(body));
  }

  // Start the server
  return app.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );
    setNodeIsReady(nodeId);
  });
}
