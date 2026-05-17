import { useState, useEffect, useCallback, KeyboardEvent, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface Contact {
    name: string;
    email: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useRecipientAutocomplete() {
    const [recipients, setRecipients] = useState<string[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    
    const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
    const queryTokenRef = useRef(0);

    const fetchContacts = useCallback(async (query: string, currentRecipients: string[]) => {
        const token = ++queryTokenRef.current;
        try {
            const results: Contact[] = await invoke('search_contacts', { query });
            
            // Stale response protection
            if (token === queryTokenRef.current) {
                // Filter out already selected recipients
                const lowerRecipients = currentRecipients.map(r => r.toLowerCase());
                const finalResults = results.filter(c => !lowerRecipients.includes(c.email.toLowerCase()));
                setFilteredContacts(finalResults);
            }
        } catch (error) {
            console.error("Failed to search contacts:", error);
            if (token === queryTokenRef.current) {
                setFilteredContacts([]);
            }
        }
    }, []);

    // Debounce and fetch
    useEffect(() => {
        // If they just opened the dropdown and input is empty, fetch top
        if (isOpen || inputValue) {
            const timer = setTimeout(() => {
                fetchContacts(inputValue, recipients);
            }, 150);
            return () => clearTimeout(timer);
        }
    }, [inputValue, isOpen, recipients, fetchContacts]);

    // Safe index bounds
    useEffect(() => {
        if (selectedIndex >= filteredContacts.length) {
            setSelectedIndex(0);
        }
    }, [filteredContacts.length, selectedIndex]);

    const addRecipient = useCallback((email: string) => {
        const trimmed = email.trim();
        if (!trimmed) return;
        setRecipients(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
    }, []);

    const removeLastRecipient = useCallback(() => {
        setRecipients(prev => {
            if (prev.length === 0) return prev;
            return prev.slice(0, prev.length - 1);
        });
    }, []);

    const removeRecipient = useCallback((email: string) => {
        setRecipients(prev => prev.filter(r => r !== email));
    }, []);

    const handleInputChange = (val: string) => {
        // Active token parsing for pasting
        // If the string contains multiple emails separated by commas, semicolons, or spaces
        if (val.includes(',') || val.includes(';')) {
            const tokens = val.split(/[,;]+/).map(t => t.trim()).filter(Boolean);
            // If the last character isn't a separator, the last token might still be being typed
            if (!/[,;\s]$/.test(val)) {
                const lastToken = tokens.pop();
                tokens.forEach(t => addRecipient(t));
                setInputValue(lastToken || "");
            } else {
                tokens.forEach(t => addRecipient(t));
                setInputValue("");
            }
        } else if (/\s/.test(val) && val.trim().split(/\s+/).length > 1) {
            // Space separated paste check (e.g. "a@b.com c@d.com")
            const tokens = val.split(/\s+/).filter(Boolean);
            if (!/\s$/.test(val)) {
                const lastToken = tokens.pop();
                // Only add space-separated tokens if they look like emails, otherwise it might be a name
                tokens.forEach(t => {
                    if (EMAIL_REGEX.test(t)) addRecipient(t);
                });
                setInputValue(lastToken || "");
            } else {
                tokens.forEach(t => {
                    if (EMAIL_REGEX.test(t)) addRecipient(t);
                });
                setInputValue("");
            }
        } else {
            setInputValue(val);
        }

        if (!isOpen && val.length > 0) setIsOpen(true);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === ' ' || e.key === ',' || e.key === ';') {
            const val = inputValue.trim();
            if (val && (e.key !== ' ' || EMAIL_REGEX.test(val))) {
                e.preventDefault();
                addRecipient(val);
                setInputValue("");
                setIsOpen(false);
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
                setSelectedIndex(0);
            } else {
                setSelectedIndex(prev => Math.min(prev + 1, filteredContacts.length - 1));
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (isOpen) {
                setSelectedIndex(prev => Math.max(prev - 1, 0));
            }
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (isOpen && filteredContacts.length > 0 && selectedIndex >= 0 && selectedIndex < filteredContacts.length) {
                e.preventDefault();
                addRecipient(filteredContacts[selectedIndex].email);
                setInputValue("");
                setIsOpen(false);
            } else if (inputValue.trim()) {
                e.preventDefault();
                addRecipient(inputValue.trim());
                setInputValue("");
                setIsOpen(false);
            }
        } else if (e.key === 'Escape') {
            if (isOpen) {
                e.preventDefault();
                setIsOpen(false);
            }
        } else if (e.key === 'Backspace' && !inputValue) {
            e.preventDefault();
            removeLastRecipient();
        }
    };

    const toggleOpen = () => {
        if (!isOpen) {
            setIsOpen(true);
            setSelectedIndex(0);
        } else {
            setIsOpen(false);
        }
    };

    return {
        recipients,
        inputValue,
        isOpen,
        selectedIndex,
        filteredContacts,
        setSelectedIndex,
        handleInputChange,
        handleKeyDown,
        removeRecipient,
        toggleOpen,
        addRecipient,
        setInputValue
    };
}
