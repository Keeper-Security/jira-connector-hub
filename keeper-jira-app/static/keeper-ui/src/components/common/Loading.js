/**
 * Loading component
 */
import React from 'react';
import Spinner from "@atlaskit/spinner";
import '../../styles/Loading.css';

const Loading = ({ message = "Loading..." }) => {
  return (
    <div className="loading-component">
      <Spinner size="large" />
      <p className="loading-component-message">{message}</p>
    </div>
  );
};

export default Loading;

