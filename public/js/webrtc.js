// WebRTC Configuration
class WebRTCManager {
  constructor() {
    this.peerConnection = null;
    this.dataChannel = null;
    this.isInitiator = false;
    this.polite = false;
    this.makingOffer = false;
    this.isSettingRemoteAnswerPending = false;
    this.ignoreOffer = false;
    this.fileQueue = [];
    this.receivedFiles = [];
    this.currentTransfer = null;
    this.startedIds = new Set();

    // STUN servers for NAT traversal
    this.config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
      ]
    };
  }

  async initializePeerConnection(socket, roomId) {
    this.socket = socket;
    this.roomId = roomId;

    this.peerConnection = new RTCPeerConnection(this.config);

    // Handle ICE candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('ice-candidate', {
          roomId: this.roomId,
          candidate: event.candidate
        });
      }
    };

    // Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log('Connection state:', state);

      if (state === 'connected') {
        updateConnectionStatus(true);
        // Notify server that connection is established
        this.socket.emit('connection-established', { roomId: this.roomId });
      } else if (state === 'disconnected' || state === 'failed') {
        // Ensure data channel can be recreated on next negotiation
        if (this.dataChannel && this.dataChannel.readyState !== 'open') {
          this.dataChannel = null;
        }
        updateConnectionStatus(false);
      }
    };

    // Handle incoming data channel
    this.peerConnection.ondatachannel = (event) => {
      const channel = event.channel;
      this.setupDataChannel(channel);
    };

    // Optional fallback: only attempt offer when safe
    this.peerConnection.onnegotiationneeded = async () => {
      try {
        if (!this.isInitiator) return;
        if (this.makingOffer) return;
        if (this.peerConnection.signalingState !== 'stable') return;
        // Only if a data channel already exists (to avoid changing m-lines order later)
        if (!this.dataChannel) return;
        await this.createOffer();
      } catch (e) {
        console.error('Negotiationneeded error:', e);
      }
    };
  }

  async createOffer() {
    this.isInitiator = true;
    if (!this.dataChannel || this.dataChannel.readyState === 'closed') {
      // Create data channel once, before first offer, to lock m-line order
      this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', { ordered: true });
      this.setupDataChannel(this.dataChannel);
    }
    if (this.makingOffer || this.peerConnection.signalingState !== 'stable') return;
    this.makingOffer = true;
    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.socket.emit('offer', { roomId: this.roomId, offer: this.peerConnection.localDescription });
      console.log('Sent offer');
    } finally {
      this.makingOffer = false;
    }
  }

  async handleOffer(offer) {
    console.log('Received offer');
    const offerCollision = this.makingOffer || this.peerConnection.signalingState !== 'stable';
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) {
      console.log('Ignored offer due to glare');
      return;
    }

    try {
      if (offerCollision) {
        await this.peerConnection.setLocalDescription({ type: 'rollback' });
      }
      await this.peerConnection.setRemoteDescription(offer);

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      this.socket.emit('answer', { roomId: this.roomId, answer: this.peerConnection.localDescription });
      console.log('Sent answer');
    } catch (e) {
      console.error('Error handling offer:', e);
    }
  }

  async handleAnswer(answer) {
    console.log('Received answer');
    await this.peerConnection.setRemoteDescription(answer);
  }

  async handleIceCandidate(candidate) {
    // Some candidates can arrive before remote/local descriptions
    console.log('Received ICE candidate');
    await this.peerConnection.addIceCandidate(candidate);
  }

  setupDataChannel(channel) {
    this.dataChannel = channel;

    channel.onopen = () => {
      console.log('Data channel opened');
      updateConnectionStatus(true);
      // Notify server that WebRTC is ready
      this.socket.emit('connection-ready', { roomId: this.roomId });
    };

    channel.onclose = () => {
      console.log('Data channel closed');
      // Allow a fresh channel to be created on next offer
      this.dataChannel = null;
      updateConnectionStatus(false);
    };

    channel.onerror = (error) => {
      console.error('Data channel error:', error);
    };

    channel.onmessage = (event) => {
      this.handleDataChannelMessage(event.data);
    };
  }

  handleDataChannelMessage(data) {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'file-info':
          this.handleFileInfo(message);
          break;
        case 'file-chunk':
          this.handleFileChunk(message);
          break;
        case 'file-complete':
          this.handleFileComplete(message);
          break;
        case 'file-cancelled':
          this.handleFileCancelled(message);
          break;
        case 'file-paused':
          this.handleFilePaused(message);
          break;
        case 'file-resumed':
          this.handleFileResumed(message);
          break;
      }
    } catch (error) {
      // Handle binary data (file chunks)
      if (this.currentTransfer && this.currentTransfer.receiving) {
        this.handleBinaryChunk(data);
      }
    }
  }

  handleFileInfo(message) {
    this.currentTransfer = {
      receiving: true,
      file: message.file,
      chunks: [],
      received: 0,
      total: message.file.size,
      startTime: Date.now()
    };

    // Display incoming item using provided id for proper correlation
    displayIncomingFile(message.file, message.file.id);
  }

  handleBinaryChunk(data) {
    if (!this.currentTransfer || !this.currentTransfer.receiving) return;

    this.currentTransfer.chunks.push(data);
    this.currentTransfer.received += data.byteLength;

    const progress = (this.currentTransfer.received / this.currentTransfer.total) * 100;
    const elapsed = Math.max(1, Date.now() - (this.currentTransfer.startTime || Date.now()));
    const speed = this.currentTransfer.received / (elapsed / 1000);
    // Update per-file progress in Incoming list
    try {
      const key = this.currentTransfer.file.id || `${this.currentTransfer.file.name}:${this.currentTransfer.file.size}`;
      if (typeof incomingFileProgress === 'function') incomingFileProgress(key, progress, speed);
    } catch (_) { }
  }

  handleFileComplete(message) {
    if (!this.currentTransfer || !this.currentTransfer.receiving) return;

    const blob = new Blob(this.currentTransfer.chunks);
    const file = {
      name: this.currentTransfer.file.name,
      size: this.currentTransfer.file.size,
      type: this.currentTransfer.file.type,
      blob: blob
    };

    this.receivedFiles.push(file);
    // Optionally flip per-file item to completed state before moving
    try {
      const key = this.currentTransfer.file.id || `${this.currentTransfer.file.name}:${this.currentTransfer.file.size}`;
      if (typeof incomingFileComplete === 'function') incomingFileComplete(key);
    } catch (_) { }
    // Attach id to file for correct transformation/move
    file.id = this.currentTransfer.file.id;
    displayReceivedFile(file);

    this.currentTransfer = null;
  }

  handleFileCancelled(message) {
    // Cancel current receive transfer if ids match
    if (this.currentTransfer && this.currentTransfer.file && this.currentTransfer.file.id === message.file.id) {
      this.currentTransfer = null;
    }
    try { if (typeof incomingFileCancelled === 'function') incomingFileCancelled(message.file.id); } catch (_) { }
  }

  handleFilePaused(message) {
    if (this.currentTransfer && this.currentTransfer.file && this.currentTransfer.file.id === message.file.id) {
      // Just mark paused; transfer loop on sender already paused
    }
    try { if (typeof incomingFilePaused === 'function') incomingFilePaused(message.file.id); } catch (_) { }
  }

  handleFileResumed(message) {
    if (this.currentTransfer && this.currentTransfer.file && this.currentTransfer.file.id === message.file.id) {
      // Resume display
    }
    try { if (typeof incomingFileResumed === 'function') incomingFileResumed(message.file.id); } catch (_) { }
  }

  async sendFile(file, transferId) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    // Send file info
    const outIdProvided = transferId && String(transferId);
    const outIdFinal = outIdProvided || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    // If user cancelled before this file began, skip entirely
    const preCtrl = window.outgoingControl ? window.outgoingControl.get(outIdFinal) : null;
    if (preCtrl && preCtrl.cancelled) {
      return false; // not started
    }
    const fileInfo = {
      type: 'file-info',
      file: {
        id: outIdFinal,
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
      }
    };

    this.dataChannel.send(JSON.stringify(fileInfo));

    // Mark as sending if UI entry pre-created
    const outId = outIdFinal;
    try { if (typeof outgoingFileMarkSending === 'function') outgoingFileMarkSending(outId); } catch (_) { }
    this.startedIds.add(outId);

    // Send file in chunks with speed throttling for anonymous users
    const chunkSize = 16384; // 16KB chunks
    const isAnonymous = !window.currentUser; // Check if user is anonymous

    // Calculate throttle delay for 0.03 MB/s (30 KB/s) for anonymous users
    // With 16KB chunks: 16384 bytes / 30720 bytes/s = ~0.53 seconds delay
    const throttleDelay = isAnonymous ? 533 : 0; // 533ms delay for anonymous users (0.03 MB/s)

    let offset = 0;
    const startTime = Date.now();

    this.currentTransfer = {
      sending: true,
      file: file,
      total: file.size,
      sent: 0
    };

    while (offset < file.size) {
      // Control flags
      const ctrl = window.outgoingControl ? window.outgoingControl.get(outId) : null;
      if (ctrl && ctrl.cancelled) {
        // Send cancellation notice to peer
        const cancelMsg = { type: 'file-cancelled', file: { id: outId, name: file.name, size: file.size } };
        try { this.dataChannel.send(JSON.stringify(cancelMsg)); } catch (_) { }
        try { if (typeof outgoingFileCancel === 'function') outgoingFileCancel(outId); } catch (_) { }
        return false; // stopped before completion
      }
      if (ctrl && ctrl.paused) {
        await new Promise(resolve => setTimeout(resolve, 200));
        continue; // skip sending while paused
      }
      const chunk = file.slice(offset, offset + chunkSize);
      const arrayBuffer = await chunk.arrayBuffer();

      // Wait if buffer is full
      while (this.dataChannel.bufferedAmount > chunkSize * 4) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      this.dataChannel.send(arrayBuffer);
      offset += chunkSize;
      this.currentTransfer.sent = offset;

      const progress = (offset / file.size) * 100;
      const elapsed = Math.max(1, Date.now() - startTime);
      const speed = offset / (elapsed / 1000);
      try {
        if (typeof outgoingFileProgress === 'function') {
          outgoingFileProgress(outId, progress, speed);
        }
      } catch (_) { }
    }

    // Send completion message
    const completeMessage = {
      type: 'file-complete',
      file: {
        name: file.name,
        size: file.size,
        id: outId
      }
    };

    this.dataChannel.send(JSON.stringify(completeMessage));

    // Mark per-file send complete
    try {
      if (typeof outgoingFileComplete === 'function') outgoingFileComplete(outId);
    } catch (_) { }

    this.currentTransfer = null;
    return true; // started and finished
  }

  async sendFiles(files, ids) {
    this.isSending = true;
    let startedCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const id = Array.isArray(ids) ? ids[i] : undefined;
      const started = await this.sendFile(file, id);
      if (started) startedCount++;
      // Small delay between files
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    this.isSending = false;
    return { started: startedCount };
  }

  disconnect() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.currentTransfer = null;
    this.fileQueue = [];
  }
}

// Utility functions for file handling
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTransferSpeed(bytesPerSecond) {
  return formatFileSize(bytesPerSecond) + '/s';
}

function getFileIcon(fileName) {
  const extension = fileName.split('.').pop().toLowerCase();

  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(extension)) {
    return 'image';
  } else if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'].includes(extension)) {
    return 'video';
  } else if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(extension)) {
    return 'audio';
  } else if (['doc', 'docx', 'pdf', 'txt', 'rtf'].includes(extension)) {
    return 'document';
  } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) {
    return 'archive';
  } else if (['js', 'html', 'css', 'py', 'java', 'cpp', 'c'].includes(extension)) {
    return 'code';
  } else {
    return 'default';
  }
}