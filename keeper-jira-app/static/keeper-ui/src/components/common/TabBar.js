/**
 * TabBar component for navigation
 */
import React from 'react';
import SettingsIcon from "@atlaskit/icon/glyph/settings";
import InfoIcon from "@atlaskit/icon/glyph/info";
import BookIcon from "@atlaskit/icon/glyph/book";
import ListIcon from "@atlaskit/icon/glyph/list";
import { TABS } from '../../constants';
import '../../styles/TabBar.css';

const TabBar = ({ activeTab, onTabChange, isAdmin }) => {
  const tabs = [
    { id: TABS.CONFIG, label: "Configuration", icon: SettingsIcon, requiresAdmin: true },
    { id: TABS.PEDM, label: "PEDM Requests", icon: ListIcon, requiresAdmin: false },
    { id: TABS.PREREQ, label: "Prerequisites", icon: BookIcon, requiresAdmin: false },
    { id: TABS.ABOUT, label: "About", icon: InfoIcon, requiresAdmin: false }
  ];

  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const isDisabled = tab.requiresAdmin && !isAdmin;

        return (
          <div
            key={tab.id}
            onClick={() => !isDisabled && onTabChange(tab.id)}
            className={`tab-bar-item ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
          >
            <Icon size="small" />
            {tab.label}
          </div>
        );
      })}
    </div>
  );
};

export default TabBar;

